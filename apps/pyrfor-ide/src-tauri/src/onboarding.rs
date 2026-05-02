use serde::Serialize;
use serde_json::Value;
use std::{fs, path::PathBuf, process::Command};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};

const PYRFOR_CONFIG_FILE: &str = "runtime.json";
const LEGACY_PYRFOR_CONFIG_FILE: &str = "pyrfor.json";
const OLLAMA_PULL_PROGRESS_EVENT: &str = "ollama:pull-progress";
const OLLAMA_PULL_FINISHED_EVENT: &str = "ollama:pull-finished";
const PROVIDER_TEST_TIMEOUT_SECS: u64 = 20;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OllamaPullProgressEvent {
    model: String,
    stream: &'static str,
    message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OllamaPullFinishedEvent {
    model: String,
    success: bool,
    code: Option<i32>,
}

fn pyrfor_root_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot locate home directory".to_string())?;
    Ok(home.join(".pyrfor"))
}

fn ensure_pyrfor_dir() -> Result<PathBuf, String> {
    let dir = pyrfor_root_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir ~/.pyrfor: {e}"))?;
    Ok(dir)
}

fn pyrfor_config_path() -> Result<PathBuf, String> {
    Ok(pyrfor_root_dir()?.join(PYRFOR_CONFIG_FILE))
}

fn legacy_pyrfor_config_path() -> Result<PathBuf, String> {
    Ok(pyrfor_root_dir()?.join(LEGACY_PYRFOR_CONFIG_FILE))
}

#[tauri::command]
pub fn pyrfor_config_exists() -> Result<bool, String> {
    Ok(pyrfor_config_path()?.exists() || legacy_pyrfor_config_path()?.exists())
}

#[tauri::command]
pub fn read_pyrfor_config() -> Result<Value, String> {
    let path = pyrfor_config_path()?;
    let legacy_path = legacy_pyrfor_config_path()?;
    let read_path = if path.exists() {
        path.clone()
    } else if legacy_path.exists() {
        legacy_path
    } else {
        return Ok(Value::Null);
    };

    let raw = fs::read_to_string(&read_path).map_err(|e| format!("read pyrfor config: {e}"))?;
    let value: Value = serde_json::from_str(&raw).map_err(|e| format!("parse pyrfor config: {e}"))?;
    if read_path != path {
        write_pyrfor_config(value.clone())?;
    }
    Ok(value)
}

#[tauri::command]
pub fn write_pyrfor_config(value: Value) -> Result<(), String> {
    ensure_pyrfor_dir()?;
    let path = pyrfor_config_path()?;
    let tmp = path.with_extension("json.tmp");
    let serialized = serde_json::to_string_pretty(&value)
        .map_err(|e| format!("serialize pyrfor config: {e}"))?;

    fs::write(&tmp, serialized).map_err(|e| format!("write pyrfor config tmp: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("rename pyrfor config: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn detect_system_memory_gb() -> Result<u64, String> {
    let bytes = detect_system_memory_bytes()?;
    Ok(bytes_to_gib_ceil(bytes))
}

#[tauri::command]
pub async fn ollama_pull_model(app: AppHandle, model: String) -> Result<(), String> {
    let binary = super::sidecar::resolve_ollama_binary()
        .ok_or_else(|| "ollama binary not found".to_string())?;

    let mut child = tokio::process::Command::new(binary)
        .arg("pull")
        .arg(&model)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn ollama pull: {e}"))?;

    let stdout_task = child.stdout.take().map(|stdout| {
        let app = app.clone();
        let model = model.clone();
        tauri::async_runtime::spawn(
            async move { emit_pull_stream(app, model, "stdout", stdout).await },
        )
    });

    let stderr_task = child.stderr.take().map(|stderr| {
        let app = app.clone();
        let model = model.clone();
        tauri::async_runtime::spawn(
            async move { emit_pull_stream(app, model, "stderr", stderr).await },
        )
    });

    let status = child
        .wait()
        .await
        .map_err(|e| format!("ollama pull wait error: {e}"))?;

    if let Some(task) = stdout_task {
        task.await.map_err(|e| e.to_string())??;
    }
    if let Some(task) = stderr_task {
        task.await.map_err(|e| e.to_string())??;
    }

    let finished = OllamaPullFinishedEvent {
        model,
        success: status.success(),
        code: status.code(),
    };
    app.emit(OLLAMA_PULL_FINISHED_EVENT, finished)
        .map_err(|e| format!("emit ollama pull finished: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "ollama pull failed with code {}",
            status.code().unwrap_or(-1)
        ))
    }
}

#[tauri::command]
pub async fn test_provider_connection(provider: String, secret: String) -> Result<(), String> {
    let provider = provider.trim().to_ascii_lowercase();
    let secret = secret.trim().to_string();
    if secret.is_empty() {
        return Err("secret is empty".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(PROVIDER_TEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("build provider test client: {e}"))?;

    let response = match provider.as_str() {
        "openrouter" => {
            client
                .get("https://openrouter.ai/api/v1/models")
                .bearer_auth(&secret)
                .send()
                .await
        }
        "openai" => {
            client
                .get("https://api.openai.com/v1/models")
                .bearer_auth(&secret)
                .send()
                .await
        }
        "zai" => {
            client
                .get("https://open.bigmodel.cn/api/paas/v4/models")
                .bearer_auth(&secret)
                .send()
                .await
        }
        "telegram" => {
            client
                .get(format!("https://api.telegram.org/bot{secret}/getMe"))
                .send()
                .await
        }
        _ => return Err(format!("unsupported provider: {provider}")),
    }
    .map_err(|e| format!("test {provider} connection: {e}"))?;

    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!(
            "{provider} connection test failed: HTTP {}",
            response.status()
        ))
    }
}

async fn emit_pull_stream<R>(
    app: AppHandle,
    model: String,
    stream: &'static str,
    reader: R,
) -> Result<(), String>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut lines = BufReader::new(reader).lines();
    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|e| format!("read ollama {stream}: {e}"))?
    {
        app.emit(
            OLLAMA_PULL_PROGRESS_EVENT,
            OllamaPullProgressEvent {
                model: model.clone(),
                stream,
                message: line,
            },
        )
        .map_err(|e| format!("emit ollama pull progress: {e}"))?;
    }
    Ok(())
}

fn detect_system_memory_bytes() -> Result<u64, String> {
    #[cfg(target_os = "macos")]
    {
        return read_command_output("sysctl", &["-n", "hw.memsize"]).and_then(|raw| {
            parse_u64_output(&raw).ok_or_else(|| "failed to parse sysctl hw.memsize".to_string())
        });
    }

    #[cfg(target_os = "linux")]
    {
        let raw =
            fs::read_to_string("/proc/meminfo").map_err(|e| format!("read /proc/meminfo: {e}"))?;
        return parse_linux_memtotal_kib(&raw)
            .map(|kib| kib.saturating_mul(1024))
            .ok_or_else(|| "failed to parse /proc/meminfo".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        return read_command_output(
            "wmic",
            &["computersystem", "get", "TotalPhysicalMemory", "/value"],
        )
        .and_then(|raw| {
            raw.lines()
                .find_map(|line| line.trim().strip_prefix("TotalPhysicalMemory="))
                .and_then(parse_u64_output)
                .ok_or_else(|| "failed to parse wmic TotalPhysicalMemory".to_string())
        });
    }

    #[allow(unreachable_code)]
    Err("detect_system_memory_gb is unsupported on this platform".to_string())
}

fn read_command_output(command: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(command)
        .args(args)
        .output()
        .map_err(|e| format!("run {command}: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "{command} exited with code {}",
            output.status.code().unwrap_or(-1)
        ));
    }

    String::from_utf8(output.stdout).map_err(|e| format!("decode {command} output: {e}"))
}

fn bytes_to_gib_ceil(bytes: u64) -> u64 {
    const GIB: u64 = 1024 * 1024 * 1024;
    if bytes == 0 {
        0
    } else {
        bytes.saturating_add(GIB - 1) / GIB
    }
}

fn parse_u64_output(raw: &str) -> Option<u64> {
    raw.trim().parse::<u64>().ok()
}

#[cfg(any(target_os = "linux", test))]
fn parse_linux_memtotal_kib(raw: &str) -> Option<u64> {
    raw.lines().find_map(|line| {
        let trimmed = line.trim();
        trimmed
            .strip_prefix("MemTotal:")
            .and_then(|value| value.split_whitespace().next())
            .and_then(parse_u64_output)
    })
}

#[cfg(test)]
mod tests {
    use super::{bytes_to_gib_ceil, parse_linux_memtotal_kib, parse_u64_output};

    #[test]
    fn parses_numeric_output() {
        assert_eq!(parse_u64_output("17179869184\n"), Some(17_179_869_184));
    }

    #[test]
    fn parses_linux_memtotal() {
        let raw = "MemTotal:       32768000 kB\nMemFree:        1024 kB\n";
        assert_eq!(parse_linux_memtotal_kib(raw), Some(32_768_000));
    }

    #[test]
    fn rounds_memory_up_to_gib() {
        assert_eq!(bytes_to_gib_ceil(1_073_741_824), 1);
        assert_eq!(bytes_to_gib_ceil(1_073_741_825), 2);
    }
}

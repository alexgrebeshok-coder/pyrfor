use std::{
  env,
  fs::{self, OpenOptions},
  net::{SocketAddr, TcpStream},
  path::{Path, PathBuf},
  process::{Command, Stdio},
  sync::atomic::{AtomicBool, Ordering},
  time::Duration,
};

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;

const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 8080;
const DEFAULT_MODEL_PATH: &str = "/Users/aleksandrgrebeshok/.openclaw/models/qwen-3b-mlx";
const DEFAULT_ADAPTER_PATH: &str =
  "/Users/aleksandrgrebeshok/.openclaw/workspace/models/qwen-ceoclaw-lora-v7";
const HEALTH_PATH: &str = "/health";
const CHAT_COMPLETIONS_PATH: &str = "/v1/chat/completions";
const REQUEST_TIMEOUT_SECS: u64 = 5;
const STARTUP_ATTEMPTS: usize = 90;
const STARTUP_SLEEP_MS: u64 = 1000;

static STARTING: AtomicBool = AtomicBool::new(false);

struct StartFlagReset(bool);

impl Drop for StartFlagReset {
  fn drop(&mut self) {
    if self.0 {
      STARTING.store(false, Ordering::SeqCst);
    }
  }
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalGatewayStatus {
  pub mode: String,
  #[serde(rename = "gatewayKind")]
  pub gateway_kind: String,
  pub available: bool,
  pub running: bool,
  pub port: u16,
  pub gateway_url: String,
  pub probe_url: String,
  pub config_path: Option<String>,
  pub chat_completions_enabled: bool,
  pub token_configured: bool,
  pub message: String,
  pub model_path: String,
  pub adapter_path: Option<String>,
  pub python_path: Option<String>,
  pub auto_start: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalGatewayChatResponse {
  pub content: String,
  pub gateway_url: String,
  pub port: u16,
  pub model: String,
  pub auto_started: bool,
}

#[derive(Debug, Deserialize)]
struct HealthResponse {
  status: Option<String>,
}

fn env_bool(name: &str, default: bool) -> bool {
  match env::var(name) {
    Ok(value) => {
      let normalized = value.trim().to_ascii_lowercase();
      match normalized.as_str() {
        "1" | "true" | "yes" | "on" => true,
        "0" | "false" | "no" | "off" => false,
        _ => default,
      }
    }
    Err(_) => default,
  }
}

fn local_host() -> String {
  env::var("CEOCLAW_MLX_HOST")
    .ok()
    .filter(|value| !value.trim().is_empty())
    .unwrap_or_else(|| DEFAULT_HOST.to_string())
}

fn local_port() -> u16 {
  env::var("CEOCLAW_MLX_PORT")
    .ok()
    .and_then(|value| value.trim().parse::<u16>().ok())
    .unwrap_or(DEFAULT_PORT)
}

fn local_model_path() -> PathBuf {
  env::var("CEOCLAW_MLX_MODEL_PATH")
    .ok()
    .filter(|value| !value.trim().is_empty())
    .map(PathBuf::from)
    .unwrap_or_else(|| PathBuf::from(DEFAULT_MODEL_PATH))
}

fn local_adapter_path() -> Option<PathBuf> {
  env::var("CEOCLAW_MLX_ADAPTER_PATH")
    .ok()
    .filter(|value| !value.trim().is_empty())
    .map(PathBuf::from)
    .or_else(|| Some(PathBuf::from(DEFAULT_ADAPTER_PATH)))
}

fn local_log_path() -> PathBuf {
  env::var("CEOCLAW_MLX_LOG_PATH")
    .ok()
    .filter(|value| !value.trim().is_empty())
    .map(PathBuf::from)
    .or_else(|| {
      env::var("HOME").ok().map(|home| {
        Path::new(&home)
          .join(".openclaw")
          .join("logs")
          .join("ceoclaw-mlx.log")
      })
    })
    .unwrap_or_else(|| PathBuf::from("/tmp/ceoclaw-mlx.log"))
}

fn local_chat_url(host: &str, port: u16) -> String {
  format!("http://{host}:{port}{CHAT_COMPLETIONS_PATH}")
}

fn local_health_url(host: &str, port: u16) -> String {
  format!("http://{host}:{port}{HEALTH_PATH}")
}

fn python_candidates() -> Vec<PathBuf> {
  let mut candidates = vec![
    PathBuf::from("python3"),
    PathBuf::from("/opt/homebrew/bin/python3"),
    PathBuf::from("/usr/local/bin/python3"),
    PathBuf::from("/usr/bin/python3"),
  ];

  if let Ok(home) = env::var("HOME") {
    candidates.push(Path::new(&home).join(".local/bin/python3"));
    candidates.push(Path::new(&home).join("Library/Python/3.9/bin/python3"));
    candidates.push(Path::new(&home).join("Library/Python/3.11/bin/python3"));
  }

  candidates
}

fn resolve_python_binary() -> Result<PathBuf, String> {
  for candidate in python_candidates() {
    let output = Command::new(&candidate).args(["-c", "import mlx_lm"]).output();
    if let Ok(output) = output {
      if output.status.success() {
        return Ok(candidate);
      }
    }
  }

  Err(format!(
    "Python with mlx_lm was not found. Tried: {}",
    python_candidates()
      .iter()
      .map(|path| path.display().to_string())
      .collect::<Vec<_>>()
      .join(", ")
  ))
}

fn is_local_ai_files_ready(model_path: &Path, adapter_path: &Option<PathBuf>) -> bool {
  model_path.exists() && adapter_path.as_ref().map(|path| path.exists()).unwrap_or(true)
}

fn is_port_open(host: &str, port: u16) -> bool {
  let address = format!("{host}:{port}");
  let socket_addr = match address.parse::<SocketAddr>() {
    Ok(addr) => addr,
    Err(_) => return false,
  };

  TcpStream::connect_timeout(&socket_addr, Duration::from_millis(250)).is_ok()
}

async fn probe_health(url: &str) -> Result<bool, String> {
  let client = Client::builder()
    .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
    .build()
    .map_err(|error| format!("Failed to create MLX health client: {error}"))?;

  match client.get(url).send().await {
    Ok(response) if response.status().is_success() => {
      let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to read MLX health response: {error}"))?;
      if body.trim().is_empty() {
        return Ok(true);
      }

      match serde_json::from_str::<HealthResponse>(&body) {
        Ok(payload) => Ok(payload
          .status
          .as_deref()
          .map(|status| status.eq_ignore_ascii_case("ok"))
          .unwrap_or(true)),
        Err(_) => Ok(true),
      }
    }
    Ok(_) => Ok(false),
    Err(_) => Ok(false),
  }
}

fn spawn_local_mlx_server(
  python: &Path,
  model_path: &Path,
  adapter_path: &Option<PathBuf>,
  host: &str,
  port: u16,
) -> Result<(), String> {
  if !model_path.exists() {
    return Err(format!(
      "MLX base model was not found at {}",
      model_path.display()
    ));
  }

  if let Some(adapter) = adapter_path {
    if !adapter.exists() {
      return Err(format!(
        "MLX adapter was not found at {}",
        adapter.display()
      ));
    }
  }

  let log_path = local_log_path();
  if let Some(parent) = log_path.parent() {
    fs::create_dir_all(parent)
      .map_err(|error| format!("Failed to create MLX log directory {}: {error}", parent.display()))?;
  }

  let stdout_file = OpenOptions::new()
    .create(true)
    .append(true)
    .open(&log_path)
    .map_err(|error| format!("Failed to open MLX log file {}: {error}", log_path.display()))?;
  let stderr_file = stdout_file
    .try_clone()
    .map_err(|error| format!("Failed to clone MLX log file handle: {error}"))?;

  let mut command = Command::new(python);
  command
    .arg("-m")
    .arg("mlx_lm.server")
    .arg("--model")
    .arg(model_path)
    .arg("--host")
    .arg(host)
    .arg("--port")
    .arg(port.to_string())
    .arg("--use-default-chat-template")
    .arg("--log-level")
    .arg("INFO");

  if let Some(adapter) = adapter_path {
    command.arg("--adapter-path").arg(adapter);
  }

  command
    .stdin(Stdio::null())
    .stdout(Stdio::from(stdout_file))
    .stderr(Stdio::from(stderr_file));

  command
    .spawn()
    .map_err(|error| format!("Failed to start MLX server: {error}"))?;

  Ok(())
}

async fn inspect_local_model() -> LocalGatewayStatus {
  let host = local_host();
  let port = local_port();
  let model_path = local_model_path();
  let adapter_path = local_adapter_path();
  let python_path = resolve_python_binary().ok();
  let probe_url = local_health_url(&host, port);
  let gateway_url = local_chat_url(&host, port);
  let files_ready = is_local_ai_files_ready(&model_path, &adapter_path);
  let running = probe_health(&probe_url).await.unwrap_or(false);
  let auto_start = env_bool("CEOCLAW_MLX_AUTO_START", true);
  let gateway_kind = if files_ready { "local" } else { "missing" };
  let message = if running {
    "Local MLX server is ready.".to_string()
  } else if !files_ready {
    format!(
      "Local MLX model files are missing. Expected base model at {}.",
      model_path.display()
    )
  } else if python_path.is_none() {
    "Python with mlx_lm is missing. Install mlx and mlx-lm to enable local AI.".to_string()
  } else if auto_start {
    "Local MLX server will be started automatically on first AI request.".to_string()
  } else {
    "Local MLX server is stopped.".to_string()
  };

  LocalGatewayStatus {
    mode: "gateway".to_string(),
    gateway_kind: gateway_kind.to_string(),
    available: running,
    running,
    port,
    gateway_url,
    probe_url,
    config_path: adapter_path.as_ref().map(|path| path.display().to_string()),
    chat_completions_enabled: files_ready,
    token_configured: true,
    message,
    model_path: model_path.display().to_string(),
    adapter_path: adapter_path.map(|path| path.display().to_string()),
    python_path: python_path.map(|path| path.display().to_string()),
    auto_start,
  }
}

async fn ensure_local_model_ready() -> Result<(LocalGatewayStatus, bool), String> {
  let host = local_host();
  let port = local_port();
  let model_path = local_model_path();
  let adapter_path = local_adapter_path();
  let python_path = resolve_python_binary()?;
  let probe_url = local_health_url(&host, port);
  let gateway_url = local_chat_url(&host, port);
  let auto_start = env_bool("CEOCLAW_MLX_AUTO_START", true);
  let files_ready = is_local_ai_files_ready(&model_path, &adapter_path);
  let port_open = is_port_open(&host, port);

  if !files_ready {
    let status = LocalGatewayStatus {
      mode: "gateway".to_string(),
      gateway_kind: "missing".to_string(),
      available: false,
      running: false,
      port,
      gateway_url,
      probe_url,
      config_path: adapter_path.as_ref().map(|path| path.display().to_string()),
      chat_completions_enabled: false,
      token_configured: true,
      message: format!(
        "Local MLX model files are missing. Expected base model at {}.",
        model_path.display()
      ),
      model_path: model_path.display().to_string(),
      adapter_path: adapter_path.map(|path| path.display().to_string()),
      python_path: Some(python_path.display().to_string()),
      auto_start,
    };
    return Ok((status, false));
  }

  let mut auto_started = false;
  if !port_open {
    if !auto_start {
      let status = LocalGatewayStatus {
        mode: "gateway".to_string(),
        gateway_kind: "local".to_string(),
        available: false,
        running: false,
        port,
        gateway_url,
        probe_url,
        config_path: adapter_path.as_ref().map(|path| path.display().to_string()),
        chat_completions_enabled: true,
        token_configured: true,
        message: "Local MLX server is stopped.".to_string(),
        model_path: model_path.display().to_string(),
        adapter_path: adapter_path.map(|path| path.display().to_string()),
        python_path: Some(python_path.display().to_string()),
        auto_start,
      };
      return Ok((status, false));
    }

    let did_start = STARTING
      .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
      .is_ok();

    if did_start {
      let _reset_flag = StartFlagReset(true);
      spawn_local_mlx_server(&python_path, &model_path, &adapter_path, &host, port)?;
      auto_started = true;

      for attempt in 0..STARTUP_ATTEMPTS {
        if probe_health(&probe_url).await.unwrap_or(false) {
          let status = LocalGatewayStatus {
            mode: "gateway".to_string(),
            gateway_kind: "local".to_string(),
            available: true,
            running: true,
            port,
            gateway_url: gateway_url.clone(),
            probe_url: probe_url.clone(),
            config_path: adapter_path.as_ref().map(|path| path.display().to_string()),
            chat_completions_enabled: true,
            token_configured: true,
            message: "Local MLX server started and is ready.".to_string(),
            model_path: model_path.display().to_string(),
            adapter_path: adapter_path.as_ref().map(|path| path.display().to_string()),
            python_path: Some(python_path.display().to_string()),
            auto_start,
          };
          return Ok((status, auto_started));
        }

        if attempt + 1 < STARTUP_ATTEMPTS {
          tokio::time::sleep(Duration::from_millis(STARTUP_SLEEP_MS)).await;
        }
      }

      let status = LocalGatewayStatus {
        mode: "gateway".to_string(),
        gateway_kind: "local".to_string(),
        available: false,
        running: false,
        port,
        gateway_url,
        probe_url,
        config_path: adapter_path.as_ref().map(|path| path.display().to_string()),
        chat_completions_enabled: true,
        token_configured: true,
        message: "Local MLX server did not become ready in time.".to_string(),
        model_path: model_path.display().to_string(),
        adapter_path: adapter_path.map(|path| path.display().to_string()),
        python_path: Some(python_path.display().to_string()),
        auto_start,
      };

      return Ok((status, auto_started));
    }
  }

  let status = LocalGatewayStatus {
    mode: "gateway".to_string(),
    gateway_kind: "local".to_string(),
    available: false,
    running: false,
    port,
    gateway_url,
    probe_url,
    config_path: adapter_path.as_ref().map(|path| path.display().to_string()),
    chat_completions_enabled: true,
    token_configured: true,
    message: "Local MLX server did not become ready in time.".to_string(),
    model_path: model_path.display().to_string(),
    adapter_path: adapter_path.map(|path| path.display().to_string()),
    python_path: Some(python_path.display().to_string()),
    auto_start,
  };

  Ok((status, auto_started))
}

#[tauri::command]
pub async fn local_gateway_status() -> LocalGatewayStatus {
  match ensure_local_model_ready().await {
    Ok((status, _)) => status,
    Err(error) => {
      let mut status = inspect_local_model().await;
      status.message = error;
      status
    }
  }
}

#[tauri::command]
pub async fn local_gateway_chat(
  prompt: String,
  run_id: String,
  session_key: Option<String>,
  model: Option<String>,
) -> Result<LocalGatewayChatResponse, String> {
  let _ = model;
  let (status, auto_started) = ensure_local_model_ready().await?;

  if !status.available {
    return Err(status.message);
  }

  let host = local_host();
  let port = status.port;
  let gateway_url = local_chat_url(&host, port);
  let model_name = status.model_path.clone();
  let session_key = session_key.unwrap_or_else(|| format!("pm-dashboard:{run_id}"));

  let client = Client::builder()
    .timeout(Duration::from_secs(300))
    .build()
    .map_err(|error| format!("Failed to create MLX client: {error}"))?;

  let response = client
    .post(&gateway_url)
    .header("x-openclaw-session-key", session_key)
    .json(&serde_json::json!({
      "model": model_name,
      "stream": false,
      "temperature": 0.0,
      "max_tokens": 2048,
      "messages": [{ "role": "user", "content": prompt }],
    }))
    .send()
    .await
    .map_err(|error| format!("Local MLX request failed: {error}"))?;

  let status_code = response.status();
  let body = response
    .text()
    .await
    .map_err(|error| format!("Failed to read Local MLX response: {error}"))?;

  if !status_code.is_success() {
    return Err(if body.trim().is_empty() {
      format!("Local MLX returned HTTP {}", status_code.as_u16())
    } else {
      format!("Local MLX returned HTTP {}: {}", status_code.as_u16(), body)
    });
  }

  let payload: Value = serde_json::from_str(&body)
    .map_err(|error| format!("Local MLX returned invalid JSON: {error}"))?;
  let content = payload
    .pointer("/choices/0/message/content")
    .and_then(Value::as_str)
    .map(str::trim)
    .filter(|text| !text.is_empty())
    .ok_or_else(|| "Local MLX response did not include assistant content.".to_string())?
    .to_string();

  Ok(LocalGatewayChatResponse {
    content,
    gateway_url,
    port,
    model: model_name,
    auto_started,
  })
}

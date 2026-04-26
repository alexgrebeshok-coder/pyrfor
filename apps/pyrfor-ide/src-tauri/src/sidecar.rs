/// sidecar.rs — Pyrfor daemon lifecycle manager.
///
/// Spawns `pyrfor-daemon` (packaged via `bundle.externalBin`), reads its
/// stdout for the `LISTENING_ON=<port>` line, stores the port in shared
/// state, and handles crash-restart with exponential backoff.
///
/// Also optionally supervises a local `ollama serve` process alongside the
/// daemon.  Set `PYRFOR_OLLAMA_AUTOSTART=false` to disable.  If no ollama
/// binary is found the supervisor emits `ollama:unavailable` and exits.
///
/// Wave A3 fills `binaries/pyrfor-daemon-aarch64-apple-darwin` and adds the
/// `LISTENING_ON=N` line to packages/engine/src/runtime/gateway.ts.
use std::{
  sync::{Arc, Mutex},
  time::Duration,
};

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::ShellExt;

/// Shared state: `None` until the daemon reports its port.
#[derive(Default)]
pub struct DaemonPort(pub Arc<Mutex<Option<u16>>>);

/// Tauri command — waits up to 5 s for the daemon port, then returns it.
#[tauri::command]
pub async fn get_daemon_port(state: State<'_, DaemonPort>) -> Result<u16, String> {
  let deadline = std::time::Instant::now() + Duration::from_secs(5);
  loop {
    {
      let guard = state.0.lock().map_err(|e| e.to_string())?;
      if let Some(port) = *guard {
        return Ok(port);
      }
    }
    if std::time::Instant::now() >= deadline {
      return Err("daemon not ready".into());
    }
    tokio::time::sleep(Duration::from_millis(100)).await;
  }
}

// ─── Internal spawn logic ────────────────────────────────────────────────────

const SIDECAR_NAME: &str = "pyrfor-daemon";
const MAX_RESTARTS: u32 = 3;
const RESTART_WINDOW_SECS: u64 = 60;

/// Called from `setup()`. Spawns the sidecar in a background task.
pub fn spawn_daemon(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
  let app_handle = app.handle().clone();
  tauri::async_runtime::spawn(async move {
    run_daemon_supervisor(app_handle).await;
  });
  Ok(())
}

async fn run_daemon_supervisor(app: AppHandle) {
  let mut restart_count: u32 = 0;
  let window_start = std::time::Instant::now();

  loop {
    // Reset backoff counter if we've been stable longer than RESTART_WINDOW_SECS.
    if window_start.elapsed().as_secs() > RESTART_WINDOW_SECS {
      restart_count = 0;
    }

    if restart_count >= MAX_RESTARTS {
      eprintln!("[pyrfor-sidecar] Too many restarts ({restart_count}). Giving up.");
      let _ = app.emit("daemon:fatal", "pyrfor-daemon crashed too many times");
      return;
    }

    // Exponential backoff: 0 s, 2 s, 4 s before each restart attempt.
    if restart_count > 0 {
      let delay = Duration::from_secs(2u64.pow(restart_count - 1));
      eprintln!("[pyrfor-sidecar] Restart #{restart_count}, waiting {delay:?}…");
      tokio::time::sleep(delay).await;
    }

    match launch_once(&app).await {
      Ok(()) => {
        // Daemon exited cleanly (app exit). Stop supervising.
        return;
      }
      Err(e) => {
        eprintln!("[pyrfor-sidecar] Daemon exited with error: {e}");
        restart_count += 1;

        // Clear the stored port so callers know the daemon is gone.
        if let Some(state) = app.try_state::<DaemonPort>() {
          if let Ok(mut guard) = state.0.lock() {
            *guard = None;
          }
        }
      }
    }
  }
}

/// Spawns the sidecar once, reads stdout until EOF, returns Ok on clean exit
/// or Err on crash.
async fn launch_once(app: &AppHandle) -> Result<(), String> {
  let sidecar_cmd = app
    .shell()
    .sidecar(SIDECAR_NAME)
    .map_err(|e| format!("Failed to build sidecar command: {e}"))?
    .env("PYRFOR_PORT", "0"); // Daemon binds on a random port.

  let (mut rx, _child) = sidecar_cmd
    .spawn()
    .map_err(|e| format!("Failed to spawn sidecar: {e}"))?;

  use tauri_plugin_shell::process::CommandEvent;

  while let Some(event) = rx.recv().await {
    match event {
      CommandEvent::Stdout(line) => {
        let text = String::from_utf8_lossy(&line);
        // Wave A3 makes gateway.ts print this line after server.listen().
        if let Some(port_str) = text.trim().strip_prefix("LISTENING_ON=") {
          if let Ok(port) = port_str.trim().parse::<u16>() {
            eprintln!("[pyrfor-sidecar] Daemon listening on port {port}");
            if let Some(state) = app.try_state::<DaemonPort>() {
              if let Ok(mut guard) = state.0.lock() {
                *guard = Some(port);
              }
            }
          }
        }
      }
      CommandEvent::Stderr(line) => {
        eprintln!("[pyrfor-daemon] {}", String::from_utf8_lossy(&line));
      }
      CommandEvent::Error(e) => {
        return Err(format!("Sidecar process error: {e}"));
      }
      CommandEvent::Terminated(status) => {
        let code = status.code.unwrap_or(-1);
        if code == 0 {
          return Ok(());
        }
        return Err(format!("Sidecar terminated with code {code}"));
      }
      _ => {}
    }
  }

  Ok(())
}

// ─── Ollama supervisor ────────────────────────────────────────────────────────

const OLLAMA_MAX_RESTARTS: u32 = 3;
const OLLAMA_RESTART_WINDOW_SECS: u64 = 60;
const OLLAMA_HEALTH_URL: &str = "http://localhost:11434/api/tags";
const OLLAMA_HEALTH_POLL_SECS: u64 = 5;

/// Called from `setup()`. Spawns the ollama supervisor in a background task.
/// Skipped if `PYRFOR_OLLAMA_AUTOSTART=false` or if no ollama binary is found.
pub fn spawn_ollama(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
  let app_handle = app.handle().clone();
  tauri::async_runtime::spawn(async move {
    run_ollama_supervisor(app_handle).await;
  });
  Ok(())
}

async fn run_ollama_supervisor(app: AppHandle) {
  // Respect opt-out flag.
  if std::env::var("PYRFOR_OLLAMA_AUTOSTART")
    .map(|v| v.eq_ignore_ascii_case("false") || v == "0")
    .unwrap_or(false)
  {
    eprintln!("[pyrfor-ollama] PYRFOR_OLLAMA_AUTOSTART disabled. Skipping.");
    return;
  }

  // Resolve the ollama binary; emit unavailable if missing.
  let binary_path = match resolve_ollama_binary() {
    Some(p) => p,
    None => {
      eprintln!("[pyrfor-ollama] No ollama binary found. Emitting ollama:unavailable.");
      let _ = app.emit("ollama:unavailable", "ollama binary not found");
      return;
    }
  };

  eprintln!("[pyrfor-ollama] Using binary: {}", binary_path.display());

  let mut restart_count: u32 = 0;
  let window_start = std::time::Instant::now();

  loop {
    // Reset backoff counter if we've been stable longer than the window.
    if window_start.elapsed().as_secs() > OLLAMA_RESTART_WINDOW_SECS {
      restart_count = 0;
    }

    if restart_count >= OLLAMA_MAX_RESTARTS {
      eprintln!("[pyrfor-ollama] Too many restarts ({restart_count}). Giving up.");
      let _ = app.emit("ollama:fatal", "ollama crashed too many times");
      return;
    }

    // Exponential backoff: 0 s, 2 s, 4 s before each restart attempt.
    if restart_count > 0 {
      let delay = Duration::from_secs(2u64.pow(restart_count - 1));
      eprintln!("[pyrfor-ollama] Restart #{restart_count}, waiting {delay:?}…");
      tokio::time::sleep(delay).await;
    }

    match launch_ollama_once(&app, &binary_path).await {
      Ok(()) => return, // clean exit — app is shutting down
      Err(e) => {
        eprintln!("[pyrfor-ollama] Exited with error: {e}");
        restart_count += 1;
      }
    }
  }
}

/// Resolves the ollama binary path.
/// Priority: bundled binary next to the app executable → `ollama` in PATH.
fn resolve_ollama_binary() -> Option<std::path::PathBuf> {
  let triple = ollama_target_triple();
  let bundled_name = if cfg!(windows) {
    format!("ollama-{triple}.exe")
  } else {
    format!("ollama-{triple}")
  };

  // 1. Bundled: Tauri places externalBin entries adjacent to the executable.
  if let Ok(exe) = std::env::current_exe() {
    if let Some(dir) = exe.parent() {
      let candidate = dir.join(&bundled_name);
      if candidate.is_file() {
        return Some(candidate);
      }
    }
  }

  // 2. System ollama in PATH.
  let sys_name = if cfg!(windows) { "ollama.exe" } else { "ollama" };
  find_in_path(sys_name)
}

/// Maps compile-time target to the Rust target-triple suffix used in binary names.
fn ollama_target_triple() -> &'static str {
  match (std::env::consts::ARCH, std::env::consts::OS) {
    ("aarch64", "macos") => "aarch64-apple-darwin",
    ("x86_64", "macos") => "x86_64-apple-darwin",
    ("x86_64", "windows") => "x86_64-pc-windows-msvc",
    ("x86_64", "linux") => "x86_64-unknown-linux-gnu",
    ("aarch64", "linux") => "aarch64-unknown-linux-gnu",
    (arch, os) => {
      eprintln!("[pyrfor-ollama] Unknown platform: {arch}-{os}");
      "unknown"
    }
  }
}

fn find_in_path(binary: &str) -> Option<std::path::PathBuf> {
  std::env::var_os("PATH").and_then(|path_var| {
    std::env::split_paths(&path_var).find_map(|dir| {
      let candidate = dir.join(binary);
      if candidate.is_file() { Some(candidate) } else { None }
    })
  })
}

/// Spawns `ollama serve` once; runs a health-check poller concurrently.
/// Returns Ok on clean exit, Err on crash.
async fn launch_ollama_once(app: &AppHandle, binary: &std::path::Path) -> Result<(), String> {
  let mut child = tokio::process::Command::new(binary)
    .arg("serve")
    .stdin(std::process::Stdio::null())
    .stdout(std::process::Stdio::null())
    .stderr(std::process::Stdio::null())
    .spawn()
    .map_err(|e| format!("Failed to spawn ollama serve: {e}"))?;

  // Poll health endpoint and emit `ollama:ready` once reachable.
  let app_clone = app.clone();
  let health_handle = tauri::async_runtime::spawn(async move {
    poll_ollama_health(app_clone).await;
  });

  let status = child
    .wait()
    .await
    .map_err(|e| format!("ollama wait error: {e}"))?;

  health_handle.abort();

  if status.success() {
    Ok(())
  } else {
    Err(format!("ollama exited with code {}", status.code().unwrap_or(-1)))
  }
}

/// Polls `OLLAMA_HEALTH_URL` every `OLLAMA_HEALTH_POLL_SECS` seconds until a
/// 200 OK is received, then emits `ollama:ready`.
async fn poll_ollama_health(app: AppHandle) {
  let client = reqwest::Client::new();
  loop {
    tokio::time::sleep(Duration::from_secs(OLLAMA_HEALTH_POLL_SECS)).await;
    match client.get(OLLAMA_HEALTH_URL).send().await {
      Ok(resp) if resp.status().is_success() => {
        let _ = app.emit("ollama:ready", ());
        return;
      }
      _ => {}
    }
  }
}

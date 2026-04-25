/// sidecar.rs — Pyrfor daemon lifecycle manager.
///
/// Spawns `pyrfor-daemon` (packaged via `bundle.externalBin`), reads its
/// stdout for the `LISTENING_ON=<port>` line, stores the port in shared
/// state, and handles crash-restart with exponential backoff.
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

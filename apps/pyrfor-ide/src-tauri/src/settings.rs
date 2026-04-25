/// settings.rs — IDE settings persistence in `~/.pyrfor/ide-settings.json`.
///
/// Uses atomic write (write to `.tmp` then rename) to prevent corruption.
use std::{fs, path::PathBuf};
use serde_json::Value;

fn pyrfor_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let dir = PathBuf::from(home).join(".pyrfor");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn settings_path() -> Result<PathBuf, String> {
    Ok(pyrfor_dir()?.join("ide-settings.json"))
}

const DEFAULT_SETTINGS: &str =
    r#"{"version":1,"theme":"auto","font":"Menlo","fontSize":13,"lineHeight":1.5,"keybindings":{},"logLevel":"info"}"#;

#[tauri::command]
pub async fn read_settings() -> Result<Value, String> {
    let path = settings_path()?;
    if !path.exists() {
        return serde_json::from_str(DEFAULT_SETTINGS).map_err(|e| e.to_string());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_settings(value: Value) -> Result<(), String> {
    let path = settings_path()?;
    let tmp = path.with_extension("json.tmp");
    let data = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    fs::write(&tmp, data.as_bytes()).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

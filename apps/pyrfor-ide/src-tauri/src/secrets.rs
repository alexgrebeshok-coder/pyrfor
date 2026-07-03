/// secrets.rs — macOS Keychain integration via `keyring` crate.
///
/// Maintains a side-index at `~/.pyrfor/secret-keys.json` to enumerate keys,
/// since the Keychain itself provides no enumeration API.
use std::{fs, path::PathBuf};

use tauri::Manager;

fn pyrfor_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let dir = PathBuf::from(home).join(".pyrfor");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn key_index_path() -> Result<PathBuf, String> {
    Ok(pyrfor_dir()?.join("secret-keys.json"))
}

fn read_key_index() -> Result<Vec<String>, String> {
    let path = key_index_path()?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str::<Vec<String>>(&raw).map_err(|e| e.to_string())
}

fn write_key_index(keys: &[String]) -> Result<(), String> {
    let path = key_index_path()?;
    let tmp = path.with_extension("json.tmp");
    let data = serde_json::to_string(keys).map_err(|e| e.to_string())?;
    fs::write(&tmp, data.as_bytes()).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn set_secret(key: String, value: String) -> Result<(), String> {
    let entry = keyring::Entry::new("dev.pyrfor.ide", &key).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())?;
    let mut keys = read_key_index().unwrap_or_default();
    if !keys.contains(&key) {
        keys.push(key);
        write_key_index(&keys)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_secret(key: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new("dev.pyrfor.ide", &key).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(val) => Ok(Some(val)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn delete_secret(key: String) -> Result<(), String> {
    let entry = keyring::Entry::new("dev.pyrfor.ide", &key).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => {}
        Err(keyring::Error::NoEntry) => {}
        Err(e) => return Err(e.to_string()),
    }
    let keys: Vec<String> = read_key_index()
        .unwrap_or_default()
        .into_iter()
        .filter(|k| k != &key)
        .collect();
    write_key_index(&keys)?;
    Ok(())
}

#[tauri::command]
pub async fn list_secret_keys() -> Result<Vec<String>, String> {
    read_key_index()
}

#[tauri::command]
pub async fn inject_provider_keys() -> Result<Vec<String>, String> {
    Ok(read_key_index()?
        .into_iter()
        .filter(|key| key.starts_with("provider:"))
        .collect())
}

#[tauri::command]
pub async fn sync_provider_credentials_to_daemon(app: tauri::AppHandle) -> Result<(), String> {
    let port = {
        let state = app.state::<crate::sidecar::DaemonPort>();
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        guard.ok_or_else(|| "daemon port unavailable".to_string())?
    };

    let mut body = serde_json::Map::new();
    for key in read_key_index().unwrap_or_default() {
        if !key.starts_with("provider:") {
            continue;
        }
        let entry = keyring::Entry::new("dev.pyrfor.ide", &key).map_err(|e| e.to_string())?;
        match entry.get_password() {
            Ok(val) => {
                body.insert(key, serde_json::Value::String(val));
            }
            Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(e.to_string()),
        }
    }

    if body.is_empty() {
        return Ok(());
    }

    let bearer = get_secret("gateway:bearer-token".to_string())
        .await?
        .unwrap_or_default();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("build credential sync client: {e}"))?;

    let mut request = client
        .post(format!("http://127.0.0.1:{port}/api/runtime/credentials"))
        .json(&body);

    if !bearer.is_empty() {
        request = request.bearer_auth(bearer);
    }

    let response = request.send().await.map_err(|e| e.to_string())?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!(
            "credential sync failed: HTTP {}",
            response.status()
        ))
    }
}

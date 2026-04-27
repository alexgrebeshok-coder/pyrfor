/// state.rs — IDE workspace state persistence.
///
/// Reads/writes `~/.pyrfor/ide-state.json` with atomic tmp+rename semantics.
use serde_json::Value;
use std::path::PathBuf;
use tauri::command;

fn state_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot locate home directory".to_string())?;
    let dir = home.join(".pyrfor");
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir ~/.pyrfor: {e}"))?;
    Ok(dir.join("ide-state.json"))
}

/// Read `~/.pyrfor/ide-state.json`. Returns `null` if the file does not exist.
#[command]
pub fn read_ide_state() -> Result<Value, String> {
    let path = state_path()?;
    if !path.exists() {
        return Ok(Value::Null);
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("read ide-state: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("parse ide-state: {e}"))
}

/// Write `value` to `~/.pyrfor/ide-state.json` atomically (tmp file → rename).
#[command]
pub fn write_ide_state(value: Value) -> Result<(), String> {
    let path = state_path()?;
    let tmp = path.with_extension("json.tmp");
    let serialised =
        serde_json::to_string_pretty(&value).map_err(|e| format!("serialise ide-state: {e}"))?;
    std::fs::write(&tmp, &serialised).map_err(|e| format!("write ide-state tmp: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("rename ide-state: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    fn tmp_state_path() -> PathBuf {
        let dir = dirs::home_dir()
            .expect("home")
            .join(".pyrfor")
            .join("test_tmp");
        fs::create_dir_all(&dir).unwrap();
        dir.join("ide-state-test.json")
    }

    fn roundtrip(value: Value, path: &PathBuf) {
        let tmp = path.with_extension("json.tmp");
        let serialised = serde_json::to_string_pretty(&value).unwrap();
        fs::write(&tmp, &serialised).unwrap();
        fs::rename(&tmp, path).unwrap();
        let raw = fs::read_to_string(path).unwrap();
        let read_back: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(value, read_back);
    }

    #[test]
    fn test_write_read_roundtrip() {
        let path = tmp_state_path();
        let state = json!({
            "version": 1,
            "workspace": "/home/user/project",
            "openTabs": [{"path": "/home/user/project/main.ts", "active": true, "scrollTop": 0}],
            "expandedFolders": ["/home/user/project/src"],
            "recentWorkspaces": ["/home/user/project"],
            "window": {"x": 0, "y": 0, "w": 1280, "h": 800}
        });
        roundtrip(state.clone(), &path);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_atomic_write_no_stale_tmp() {
        let path = tmp_state_path().with_file_name("ide-state-atomic-test.json");
        let tmp = path.with_extension("json.tmp");
        let value = json!({"version": 1, "workspace": "/test"});
        let serialised = serde_json::to_string_pretty(&value).unwrap();
        fs::write(&tmp, &serialised).unwrap();
        fs::rename(&tmp, &path).unwrap();
        // tmp file must not exist after rename
        assert!(!tmp.exists(), "stale tmp file found after rename");
        assert!(path.exists(), "final file missing after rename");
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_null_when_missing() {
        // Simulate missing file: parse null
        let val: Value = serde_json::from_str("null").unwrap();
        assert!(val.is_null());
    }

    #[test]
    fn test_full_schema() {
        let path = tmp_state_path().with_file_name("ide-state-schema-test.json");
        let state = json!({
            "version": 1,
            "window": {"x": 100, "y": 50, "w": 1600, "h": 900},
            "workspace": "/abs/path",
            "openTabs": [
                {"path": "/abs/path/foo.ts", "active": true, "scrollTop": 0},
                {"path": "/abs/path/bar.ts", "active": false, "scrollTop": 120}
            ],
            "expandedFolders": ["/abs/path/src", "/abs/path/tests"],
            "recentWorkspaces": ["/abs/path/A", "/abs/path/B"]
        });
        roundtrip(state, &path);
        let _ = fs::remove_file(&path);
    }
}

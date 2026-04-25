/// secrets_test.rs — smoke tests for the keyring integration.
///
/// These tests are marked `#[ignore]` by default because they require
/// a real macOS Keychain (not available in CI without a keychain daemon).
/// Run locally with: `cargo test -- --ignored`
#[cfg(test)]
mod tests {
    #[test]
    #[ignore = "requires macOS Keychain — run locally with `cargo test -- --ignored`"]
    fn set_and_get_secret() {
        let entry =
            keyring::Entry::new("dev.pyrfor.ide.test", "test-key").expect("create entry");
        entry.set_password("test-value").expect("set_password");
        let got = entry.get_password().expect("get_password");
        assert_eq!(got, "test-value");
        entry.delete_credential().expect("delete_credential");
    }

    #[test]
    #[ignore = "requires macOS Keychain — run locally with `cargo test -- --ignored`"]
    fn get_nonexistent_returns_no_entry() {
        let entry =
            keyring::Entry::new("dev.pyrfor.ide.test", "nonexistent-key-xyz").expect("create entry");
        match entry.get_password() {
            Err(keyring::Error::NoEntry) => {}
            other => panic!("expected NoEntry, got {other:?}"),
        }
    }

    #[test]
    #[ignore = "requires macOS Keychain — run locally with `cargo test -- --ignored`"]
    fn delete_nonexistent_is_ok() {
        let entry =
            keyring::Entry::new("dev.pyrfor.ide.test", "nonexistent-key-del").expect("create entry");
        // Should not panic — library treats no-entry delete as success
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => panic!("unexpected error: {e}"),
        }
    }
}

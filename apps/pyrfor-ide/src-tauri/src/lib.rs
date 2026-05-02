mod onboarding;
mod secrets;
mod settings;
mod sidecar;
mod state;

use tauri::{
    menu::{Menu, MenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(sidecar::DaemonPort::default())
        .invoke_handler(tauri::generate_handler![
            sidecar::get_daemon_port,
            onboarding::pyrfor_config_exists,
            onboarding::read_pyrfor_config,
            onboarding::write_pyrfor_config,
            onboarding::detect_system_memory_gb,
            onboarding::ollama_pull_model,
            onboarding::test_provider_connection,
            state::read_ide_state,
            state::write_ide_state,
            secrets::set_secret,
            secrets::get_secret,
            secrets::delete_secret,
            secrets::list_secret_keys,
            secrets::inject_provider_keys,
            settings::read_settings,
            settings::write_settings,
        ])
        .setup(|app| {
            // Release builds always spawn the bundled sidecar from this app build.
            // Debug builds can opt into a standalone Engine with PYRFOR_ALLOW_STANDALONE_ENGINE=true.
            sidecar::spawn_daemon(app)?;
            // Optionally spawn a local ollama serve process alongside the daemon.
            sidecar::spawn_ollama(app)?;

            // File menu: Open Folder / Save / Quit
            let open_folder_item =
                MenuItem::with_id(app, "open_folder", "Open Folder…", true, Some("Cmd+O"))?;
            let save_item = MenuItem::with_id(app, "save", "Save", true, Some("Cmd+S"))?;
            let sep = MenuItem::with_id(app, "sep1", "", false, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Pyrfor", true, Some("Cmd+Q"))?;

            let file_menu = Submenu::with_items(
                app,
                "File",
                true,
                &[&open_folder_item, &save_item, &sep, &quit_item],
            )?;

            let menu = Menu::with_items(app, &[&file_menu])?;
            app.set_menu(menu)?;

            app.on_menu_event(|app, event| match event.id.as_ref() {
                "open_folder" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window
                            .eval("window.__pyrfor_openFolder && window.__pyrfor_openFolder()");
                    }
                }
                "save" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ =
                            window.eval("window.__pyrfor_saveFile && window.__pyrfor_saveFile()");
                    }
                }
                "quit" => app.exit(0),
                _ => {}
            });

            // Tray
            let show_item = MenuItem::with_id(app, "show_tray", "Show Pyrfor", true, None::<&str>)?;
            let quit_tray_item = MenuItem::with_id(app, "quit_tray", "Quit", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_tray_item])?;

            TrayIconBuilder::new()
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show_tray" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit_tray" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Pyrfor IDE");
}

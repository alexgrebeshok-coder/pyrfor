mod local_gateway;

use tauri::{
  menu::{Menu, MenuItem, Submenu},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  Manager,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_window_state::Builder::default().build())
    .invoke_handler(tauri::generate_handler![
      local_gateway::local_gateway_status,
      local_gateway::local_gateway_chat
    ])
    .setup(|app| {
      // Create native menu items
      let projects_item = MenuItem::with_id(app, "projects", "Projects", true, None::<&str>)?;
      let tasks_item = MenuItem::with_id(app, "tasks", "Tasks", true, None::<&str>)?;
      let risks_item = MenuItem::with_id(app, "risks", "Risks", true, None::<&str>)?;
      let analytics_item = MenuItem::with_id(app, "analytics", "Analytics", true, None::<&str>)?;
      let separator1 = MenuItem::with_id(app, "sep1", "", false, None::<&str>)?;
      let search_item = MenuItem::with_id(app, "search", "Search...", true, None::<&str>)?;
      let settings_item = MenuItem::with_id(app, "settings", "Settings...", true, None::<&str>)?;

      // File menu
      let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
          &projects_item,
          &tasks_item,
          &risks_item,
          &analytics_item,
          &separator1,
          &search_item,
          &settings_item,
        ],
      )?;

      // Main menu bar
      let menu = Menu::with_items(app, &[&file_menu])?;
      app.set_menu(menu)?;

      // Handle menu events
      app.on_menu_event(|app, event| {
        if let Some(window) = app.get_webview_window("main") {
          let route = match event.id.as_ref() {
            "projects" => Some("/projects"),
            "tasks" => Some("/tasks"),
            "risks" => Some("/risks"),
            "analytics" => Some("/analytics"),
            "search" => Some("/search"),
            "settings" => Some("/settings"),
            _ => None,
          };

          if let Some(route) = route {
            let js = format!("window.location.href = '{}'", route);
            let _ = window.eval(&js);
          }
        }
      });

      // Tray menu
      let show_item = MenuItem::with_id(app, "show_tray", "Show CEOClaw", true, None::<&str>)?;
      let quit_item = MenuItem::with_id(app, "quit_tray", "Quit", true, None::<&str>)?;
      let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

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
        .on_tray_icon_event(|tray, event| match event {
          TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
          } => {
            let app = tray.app_handle();
            if let Some(window) = app.get_webview_window("main") {
              let _ = window.unminimize();
              let _ = window.show();
              let _ = window.set_focus();
            }
          }
          _ => {}
        })
        .build(app)?;

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

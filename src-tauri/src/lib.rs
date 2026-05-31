mod google_tasks;
mod sync_engine;

use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

#[tauri::command]
fn toggle_main_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "未找到 main 窗口".to_string())?;

    let visible = window.is_visible().map_err(|error| error.to_string())?;
    let minimized = window.is_minimized().map_err(|error| error.to_string())?;

    if visible && !minimized {
        window
            .set_skip_taskbar(true)
            .map_err(|error| error.to_string())?;
        window.hide().map_err(|error| error.to_string())?;
        return Ok(());
    }

    window
        .set_skip_taskbar(false)
        .map_err(|error| error.to_string())?;
    window.unminimize().map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn hide_main_window_to_tray(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "未找到 main 窗口".to_string())?;

    window
        .set_skip_taskbar(true)
        .map_err(|error| error.to_string())?;
    window.hide().map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("Google Todo")
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .manage(google_tasks::GoogleTasksState::default())
        .setup(|app| {
            let Some(icon) = app.default_window_icon().cloned() else {
                return Ok(());
            };

            TrayIconBuilder::with_id("main-tray")
                .tooltip("Google Todo")
                .icon(icon)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    }
                    | TrayIconEvent::DoubleClick {
                        button: MouseButton::Left,
                        ..
                    } => {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.set_skip_taskbar(false);
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
        .on_window_event(|window, event| {
            if window.label() == "main"
                && matches!(event, WindowEvent::Resized(_))
                && window.is_minimized().unwrap_or(false)
            {
                let _ = window.set_skip_taskbar(true);
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            toggle_main_window,
            hide_main_window_to_tray,
            google_tasks::google_auth_status,
            google_tasks::google_proxy_config,
            google_tasks::google_save_proxy_config,
            google_tasks::google_save_client_id,
            google_tasks::google_save_client_credentials,
            google_tasks::google_oauth_login,
            google_tasks::google_sign_out,
            google_tasks::google_task_lists,
            google_tasks::google_tasks,
            google_tasks::google_calendar_lists,
            google_tasks::google_calendar_events,
            google_tasks::google_update_calendar_event,
            google_tasks::google_delete_calendar_event,
            google_tasks::google_create_task,
            google_tasks::google_update_task,
            google_tasks::google_delete_task,
            google_tasks::google_move_task,
            sync_engine::sync_cached_snapshot,
            sync_engine::sync_google_now,
            sync_engine::sync_create_task,
            sync_engine::sync_update_task,
            sync_engine::sync_delete_task,
            sync_engine::sync_move_task
        ])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}

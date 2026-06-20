mod google_tasks;
mod sync_engine;

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_NEW_TASK_ID: &str = "tray-new-task";
const TRAY_OPEN_HOME_ID: &str = "tray-open-home";
const TRAY_QUIT_ID: &str = "tray-quit";
const TRAY_NEW_TASK_EVENT: &str = "google-todo://tray-new-task";
const TRAY_OPEN_HOME_EVENT: &str = "google-todo://tray-open-home";

fn show_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "未找到 main 窗口".to_string())?;

    window
        .set_skip_taskbar(false)
        .map_err(|error| error.to_string())?;
    window.unminimize().map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

fn hide_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "未找到 main 窗口".to_string())?;

    window
        .set_skip_taskbar(true)
        .map_err(|error| error.to_string())?;
    window.hide().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn toggle_main_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "未找到 main 窗口".to_string())?;

    let visible = window.is_visible().map_err(|error| error.to_string())?;
    let minimized = window.is_minimized().map_err(|error| error.to_string())?;

    if visible && !minimized {
        return hide_main_window(&app);
    }

    show_main_window(&app)
}

#[tauri::command]
fn hide_main_window_to_tray(app: tauri::AppHandle) -> Result<(), String> {
    hide_main_window(&app)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = show_main_window(app);
        }))
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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

            let new_task_item = MenuItemBuilder::with_id(TRAY_NEW_TASK_ID, "新增任务").build(app)?;
            let open_home_item = MenuItemBuilder::with_id(TRAY_OPEN_HOME_ID, "进入主页").build(app)?;
            let quit_item = MenuItemBuilder::with_id(TRAY_QUIT_ID, "关闭应用").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&new_task_item)
                .item(&open_home_item)
                .separator()
                .item(&quit_item)
                .build()?;

            TrayIconBuilder::with_id("main-tray")
                .tooltip("Google Todo")
                .icon(icon)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    TRAY_NEW_TASK_ID => {
                        let _ = app.emit_to(MAIN_WINDOW_LABEL, TRAY_NEW_TASK_EVENT, ());
                    }
                    TRAY_OPEN_HOME_ID => {
                        let _ = show_main_window(app);
                        let _ = app.emit_to(MAIN_WINDOW_LABEL, TRAY_OPEN_HOME_EVENT, ());
                    }
                    TRAY_QUIT_ID => {
                        app.exit(0);
                    }
                    _ => {}
                })
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
                        let _ = show_main_window(tray.app_handle());
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == MAIN_WINDOW_LABEL
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
            google_tasks::google_forget_invalid_auth,
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

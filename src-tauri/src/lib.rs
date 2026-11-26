mod backend;
mod runtime;

use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, State};

use backend::{BackendInfo, BackendState};
use runtime::RuntimeStatus;

#[tauri::command]
fn runtime_status(app: AppHandle) -> RuntimeStatus {
    runtime::status(&app)
}

#[tauri::command]
async fn install_runtime(
    app: AppHandle,
    state: State<'_, Mutex<BackendState>>,
) -> Result<RuntimeStatus, String> {
    {
        let mut state = state
            .lock()
            .map_err(|_| "Backend state lock is poisoned.".to_string())?;
        state.stop();
    }
    runtime::install(&app).await
}

#[tauri::command]
fn remove_runtime(
    app: AppHandle,
    state: State<'_, Mutex<BackendState>>,
) -> Result<RuntimeStatus, String> {
    let mut state = state
        .lock()
        .map_err(|_| "Backend state lock is poisoned.".to_string())?;
    state.stop();
    runtime::remove(&app)
}
#[tauri::command]
fn start_backend(
    app: AppHandle,
    state: State<'_, Mutex<BackendState>>,
) -> Result<BackendInfo, String> {
    let mut state = state
        .lock()
        .map_err(|_| "Backend state lock is poisoned.".to_string())?;
    state.start(&app)
}
#[tauri::command]
fn backend_status(state: State<'_, Mutex<BackendState>>) -> Result<Option<BackendInfo>, String> {
    let mut state = state
        .lock()
        .map_err(|_| "Backend state lock is poisoned.".to_string())?;
    Ok(state.info_if_running())
}

#[tauri::command]
fn stop_backend(state: State<'_, Mutex<BackendState>>) -> Result<(), String> {
    let mut state = state
        .lock()
        .map_err(|_| "Backend state lock is poisoned.".to_string())?;
    state.stop();
    Ok(())
}

fn setup_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "Show TTSForge", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let icon = app.default_window_icon().cloned().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "TTSForge tray icon is not configured",
        )
    })?;
    let tray = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("TTSForge Local Audiobook Builder")
        .on_menu_event(|app, event| {
            let Some(window) = app.get_webview_window("main") else {
                return;
            };
            match event.id().as_ref() {
                "show" => {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                "quit" => {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.close();
                }
                _ => {}
            }
        })
        .build(app)?;
    let _ = app.manage(tray);
    Ok(())
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(BackendState::default()))
        .setup(setup_tray)
        .invoke_handler(tauri::generate_handler![
            runtime_status,
            remove_runtime,
            install_runtime,
            backend_status,
            start_backend,
            stop_backend
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if let Ok(mut state) = window.state::<Mutex<BackendState>>().lock() {
                    state.stop();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building TTSForge");

    app.run(|app, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            if let Some(state) = app.try_state::<Mutex<BackendState>>() {
                if let Ok(mut state) = state.lock() {
                    state.stop();
                }
            }
        }
    });
}

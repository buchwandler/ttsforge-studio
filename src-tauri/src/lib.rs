mod backend;
mod runtime;

use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

use backend::{BackendInfo, BackendState};
use runtime::RuntimeStatus;

#[tauri::command]
fn runtime_status(app: AppHandle) -> RuntimeStatus {
    runtime::status(&app)
}

#[tauri::command]
async fn install_runtime(app: AppHandle) -> Result<RuntimeStatus, String> {
    runtime::install(&app).await
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
fn stop_backend(state: State<'_, Mutex<BackendState>>) -> Result<(), String> {
    let mut state = state
        .lock()
        .map_err(|_| "Backend state lock is poisoned.".to_string())?;
    state.stop();
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(BackendState::default()))
        .invoke_handler(tauri::generate_handler![
            runtime_status,
            install_runtime,
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
        .run(tauri::generate_context!())
        .expect("error while running TTSForge Studio");
}

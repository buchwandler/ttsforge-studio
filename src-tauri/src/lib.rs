mod backend;
mod engines;
mod runtime;

use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, State};

use backend::{BackendInfo, BackendState};
use engines::{
    EngineAction, EngineMutationResult, EnginePackageState, EnginePackageStatus,
    RuntimeMutationGate,
};
use runtime::RuntimeStatus;

#[tauri::command]
fn runtime_status(app: AppHandle) -> RuntimeStatus {
    runtime::status(&app)
}

#[tauri::command]
fn engine_status(
    app: AppHandle,
    state: State<'_, Mutex<BackendState>>,
) -> Result<Vec<EnginePackageStatus>, String> {
    let mut backend = state
        .lock()
        .map_err(|_| "Backend state lock is poisoned.".to_string())?;
    engines::status(&app, &mut backend)
}

#[tauri::command]
async fn install_runtime(
    app: AppHandle,
    state: State<'_, Mutex<BackendState>>,
    mutation: State<'_, RuntimeMutationGate>,
) -> Result<RuntimeStatus, String> {
    let _guard = mutation.acquire()?;
    let backend_was_running = stop_backend_for_mutation(&state)?;
    let operation = async {
        let status = runtime::install(&app).await?;
        engines::reinstall_desired(&app).await?;
        Ok::<RuntimeStatus, String>(status)
    }
    .await;
    let restart = restart_backend_if_needed(&app, &state, backend_was_running);
    match (operation, restart) {
        (Ok(status), Ok(_)) => Ok(status),
        (Err(error), Ok(_)) => Err(error),
        (Ok(_), Err(error)) => Err(format!(
            "Runtime installation succeeded, but backend restart failed: {error}"
        )),
        (Err(error), Err(restart_error)) => Err(format!(
            "{error}; backend restart also failed: {restart_error}"
        )),
    }
}

fn should_clear_desired_engine_choices(reset_engine_choices: Option<bool>) -> bool {
    reset_engine_choices.unwrap_or(false)
}

#[tauri::command]
fn remove_runtime(
    app: AppHandle,
    state: State<'_, Mutex<BackendState>>,
    mutation: State<'_, RuntimeMutationGate>,
    reset_engine_choices: Option<bool>,
) -> Result<RuntimeStatus, String> {
    let _guard = mutation.acquire()?;
    let backend_was_running = stop_backend_for_mutation(&state)?;
    match runtime::remove(&app) {
        Ok(status) => {
            if should_clear_desired_engine_choices(reset_engine_choices) {
                engines::clear_desired(&app)?;
            }
            Ok(status)
        }
        Err(error) if backend_was_running => match restart_backend_if_needed(&app, &state, true) {
            Ok(_) => Err(error),
            Err(restart_error) => Err(format!(
                "{error}; backend restart also failed: {restart_error}"
            )),
        },
        Err(error) => Err(error),
    }
}

#[tauri::command]
async fn install_engine(
    app: AppHandle,
    state: State<'_, Mutex<BackendState>>,
    mutation: State<'_, RuntimeMutationGate>,
    engine_id: String,
) -> Result<EngineMutationResult, String> {
    mutate_engine(app, state, mutation, engine_id, EngineAction::Install).await
}

#[tauri::command]
async fn update_engine(
    app: AppHandle,
    state: State<'_, Mutex<BackendState>>,
    mutation: State<'_, RuntimeMutationGate>,
    engine_id: String,
) -> Result<EngineMutationResult, String> {
    mutate_engine(app, state, mutation, engine_id, EngineAction::Update).await
}

#[tauri::command]
async fn repair_engine(
    app: AppHandle,
    state: State<'_, Mutex<BackendState>>,
    mutation: State<'_, RuntimeMutationGate>,
    engine_id: String,
) -> Result<EngineMutationResult, String> {
    mutate_engine(app, state, mutation, engine_id, EngineAction::Repair).await
}

#[tauri::command]
async fn remove_engine(
    app: AppHandle,
    state: State<'_, Mutex<BackendState>>,
    mutation: State<'_, RuntimeMutationGate>,
    engine_id: String,
) -> Result<EngineMutationResult, String> {
    mutate_engine(app, state, mutation, engine_id, EngineAction::Remove).await
}

async fn mutate_engine(
    app: AppHandle,
    state: State<'_, Mutex<BackendState>>,
    mutation: State<'_, RuntimeMutationGate>,
    engine_id: String,
    action: EngineAction,
) -> Result<EngineMutationResult, String> {
    engines::validate_engine_id(&engine_id)?;
    let _guard = mutation.acquire()?;
    let backend_was_running = stop_backend_for_mutation(&state)?;
    let operation = engines::mutate(&app, &engine_id, action).await;
    let restart = restart_backend_if_needed(&app, &state, backend_was_running);
    if let Err(error) = operation {
        return match restart {
            Ok(_) => Err(error),
            Err(restart_error) => Err(format!(
                "{error}; backend restart also failed: {restart_error}"
            )),
        };
    }

    let (backend_restarted, mut message) = match restart {
        Ok(restarted) => (restarted, None),
        Err(error) => (
            false,
            Some(format!(
                "Engine package mutation succeeded, but backend restart failed: {error}"
            )),
        ),
    };
    let mut backend = state
        .lock()
        .map_err(|_| "Backend state lock is poisoned.".to_string())?;
    let mut result = engines::status_for_mutation(
        &app,
        &mut backend,
        &engine_id,
        backend_was_running,
        backend_restarted,
        message.take(),
    )?;
    let degraded = match action {
        EngineAction::Remove => result.status.catalog_installed == Some(true),
        EngineAction::Install | EngineAction::Update | EngineAction::Repair => matches!(
            result.status.state,
            EnginePackageState::Broken | EnginePackageState::Incompatible
        ),
    };
    if degraded {
        let reason = result
            .status
            .catalog_reason
            .as_deref()
            .unwrap_or("TTSForge did not report the expected engine state.");
        let message =
            format!("Package mutation succeeded, but engine health is degraded: {reason}");
        result.message = Some(match result.message.take() {
            Some(previous) => format!("{previous} {message}"),
            None => message,
        });
    }
    Ok(result)
}

fn stop_backend_for_mutation(state: &Mutex<BackendState>) -> Result<bool, String> {
    let mut backend = state
        .lock()
        .map_err(|_| "Backend state lock is poisoned.".to_string())?;
    let was_running = backend.info_if_running().is_some();
    if was_running {
        if backend.has_active_jobs()? {
            return Err(
                "engine_change_blocked_active_job: Wait for the current conversion to finish or cancel it before changing engines or the runtime.".into(),
            );
        }
        backend.stop();
    }
    Ok(was_running)
}

fn restart_backend_if_needed(
    app: &AppHandle,
    state: &Mutex<BackendState>,
    was_running: bool,
) -> Result<bool, String> {
    if !was_running {
        return Ok(false);
    }
    let mut backend = state
        .lock()
        .map_err(|_| "Backend state lock is poisoned.".to_string())?;
    backend.start(app)?;
    Ok(true)
}
#[tauri::command]
fn start_backend(
    app: AppHandle,
    state: State<'_, Mutex<BackendState>>,
    mutation: State<'_, RuntimeMutationGate>,
) -> Result<BackendInfo, String> {
    let _guard = mutation.acquire()?;
    let mut backend = state
        .lock()
        .map_err(|_| "Backend state lock is poisoned.".to_string())?;
    backend.start(&app)
}

#[tauri::command]
fn backend_status(state: State<'_, Mutex<BackendState>>) -> Result<Option<BackendInfo>, String> {
    let mut backend = state
        .lock()
        .map_err(|_| "Backend state lock is poisoned.".to_string())?;
    Ok(backend.info_if_running())
}

#[tauri::command]
fn stop_backend(state: State<'_, Mutex<BackendState>>) -> Result<(), String> {
    let mut backend = state
        .lock()
        .map_err(|_| "Backend state lock is poisoned.".to_string())?;
    backend.stop();
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

#[cfg(test)]
mod tests {
    use super::should_clear_desired_engine_choices;

    #[test]
    fn runtime_removal_preserves_desired_engine_choices_by_default() {
        assert!(!should_clear_desired_engine_choices(None));
        assert!(!should_clear_desired_engine_choices(Some(false)));
        assert!(should_clear_desired_engine_choices(Some(true)));
    }
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(BackendState::default()))
        .manage(RuntimeMutationGate::default())
        .setup(setup_tray)
        .invoke_handler(tauri::generate_handler![
            runtime_status,
            engine_status,
            remove_runtime,
            install_runtime,
            install_engine,
            update_engine,
            repair_engine,
            remove_engine,
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

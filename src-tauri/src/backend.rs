use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use uuid::Uuid;

use crate::runtime;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendInfo {
    pub base_url: String,
    pub token: String,
}

#[derive(Default)]
pub struct BackendState {
    child: Option<Child>,
    info: Option<BackendInfo>,
}

impl BackendState {
    pub fn info_if_running(&mut self) -> Option<BackendInfo> {
        let child = self.child.as_mut()?;
        match child.try_wait() {
            Ok(None) => self.info.clone(),
            Ok(Some(_)) | Err(_) => {
                self.child = None;
                self.info = None;
                None
            }
        }
    }

    pub fn start(&mut self, app: &AppHandle) -> Result<BackendInfo, String> {
        if let Some(info) = self.info_if_running() {
            return Ok(info);
        }

        let runtime_status = runtime::status(app);
        if !runtime_status.installed {
            return Err("Install the managed TTSForge runtime first.".into());
        }

        let runtime_root = runtime::runtime_root(app)?;
        let python = runtime::venv_python(&runtime_root);
        let state_root = runtime::server_state_root(app)?;
        let logs = state_root.join("logs");
        fs::create_dir_all(&logs)
            .map_err(|error| format!("Cannot create backend log directory: {error}"))?;

        let listener = TcpListener::bind(("127.0.0.1", 0))
            .map_err(|error| format!("Cannot reserve a local backend port: {error}"))?;
        let port = listener
            .local_addr()
            .map_err(|error| format!("Cannot inspect reserved backend port: {error}"))?
            .port();
        drop(listener);

        let token = Uuid::new_v4().to_string();
        let base_url = format!("http://127.0.0.1:{port}");
        let log_path = logs.join("backend.log");
        let stdout = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map_err(|error| format!("Cannot open {}: {error}", log_path.display()))?;
        let stderr = stdout
            .try_clone()
            .map_err(|error| format!("Cannot clone backend log handle: {error}"))?;

        let mut command = Command::new(&python);
        command
            .arg("-m")
            .arg("ttsforge.server")
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(port.to_string())
            .arg("--token")
            .arg(&token)
            .arg("--state-dir")
            .arg(&state_root)
            .env("TTSFORGE_STUDIO", "1")
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr));

        let mut child = command
            .spawn()
            .map_err(|error| format!("Cannot start TTSForge backend: {error}"))?;

        let deadline = Instant::now() + Duration::from_secs(8);
        loop {
            if TcpStream::connect(("127.0.0.1", port)).is_ok() {
                break;
            }

            if let Ok(Some(status)) = child.try_wait() {
                return Err(format!(
                    "TTSForge backend exited during startup with status {status}. See {}.",
                    log_path.display()
                ));
            }

            if Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "TTSForge backend did not become reachable. See {}.",
                    log_path.display()
                ));
            }

            thread::sleep(Duration::from_millis(80));
        }

        let info = BackendInfo { base_url, token };
        self.child = Some(child);
        self.info = Some(info.clone());
        Ok(info)
    }

    pub fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.info = None;
    }
}

impl Drop for BackendState {
    fn drop(&mut self) {
        self.stop();
    }
}

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;

const PYTHON_VERSION: &str = "3.13";
const TTSFORGE_REQUIREMENT: &str = "ttsforge[studio]>=0.5.0,<0.6";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub installed: bool,
    pub runtime_dir: Option<String>,
    pub python_version: Option<String>,
    pub ttsforge_version: Option<String>,
    pub message: String,
}

pub fn runtime_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Cannot resolve application data directory: {error}"))?
        .join("runtime");
    Ok(root)
}

pub fn server_state_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Cannot resolve application data directory: {error}"))?
        .join("server"))
}

pub fn venv_python(root: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        root.join("venv").join("Scripts").join("python.exe")
    }
    #[cfg(not(target_os = "windows"))]
    {
        root.join("venv").join("bin").join("python")
    }
}

fn capture(program: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub fn status(app: &AppHandle) -> RuntimeStatus {
    let root = match runtime_root(app) {
        Ok(value) => value,
        Err(error) => {
            return RuntimeStatus {
                installed: false,
                runtime_dir: None,
                python_version: None,
                ttsforge_version: None,
                message: error,
            }
        }
    };

    let python = venv_python(&root);
    if !python.is_file() {
        return RuntimeStatus {
            installed: false,
            runtime_dir: Some(root.display().to_string()),
            python_version: None,
            ttsforge_version: None,
            message: "Managed Python environment has not been installed.".into(),
        };
    }

    let python_version = capture(
        &python,
        &[
            "-c",
            "import sys; print('.'.join(map(str, sys.version_info[:3])))",
        ],
    );
    let ttsforge_version = capture(
        &python,
        &[
            "-c",
            "import importlib.metadata as m; print(m.version('ttsforge'))",
        ],
    );

    let installed = python_version.is_some() && ttsforge_version.is_some();

    RuntimeStatus {
        installed,
        runtime_dir: Some(root.display().to_string()),
        python_version,
        ttsforge_version,
        message: if installed {
            "Managed TTSForge runtime is ready.".into()
        } else {
            "Managed Python exists, but TTSForge is not ready.".into()
        },
    }
}

async fn run_uv(app: &AppHandle, root: &Path, args: Vec<String>) -> Result<(), String> {
    let python_dir = root.join("python");
    let cache_dir = root.join("uv-cache");

    let output = app
        .shell()
        .sidecar("uv")
        .map_err(|error| {
            format!(
                "Bundled uv sidecar is unavailable: {error}. Run scripts/fetch-uv.py before building."
            )
        })?
        .args(args)
        .env("UV_PYTHON_INSTALL_DIR", python_dir.as_os_str())
        .env("UV_CACHE_DIR", cache_dir.as_os_str())
        .env("UV_PYTHON_PREFERENCE", "only-managed")
        .output()
        .await
        .map_err(|error| format!("Failed to execute uv: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("uv failed: {}", stderr.trim()));
    }

    Ok(())
}

pub async fn install(app: &AppHandle) -> Result<RuntimeStatus, String> {
    let root = runtime_root(app)?;
    fs::create_dir_all(&root)
        .map_err(|error| format!("Cannot create runtime directory {}: {error}", root.display()))?;

    run_uv(
        app,
        &root,
        vec!["python".into(), "install".into(), PYTHON_VERSION.into()],
    )
    .await?;

    let venv = root.join("venv");
    run_uv(
        app,
        &root,
        vec![
            "venv".into(),
            venv.display().to_string(),
            "--python".into(),
            PYTHON_VERSION.into(),
        ],
    )
    .await?;

    let python = venv_python(&root);
    run_uv(
        app,
        &root,
        vec![
            "pip".into(),
            "install".into(),
            "--python".into(),
            python.display().to_string(),
            TTSFORGE_REQUIREMENT.into(),
        ],
    )
    .await?;

    let result = status(app);
    if !result.installed {
        return Err("Runtime provisioning finished, but TTSForge could not be verified.".into());
    }
    Ok(result)
}

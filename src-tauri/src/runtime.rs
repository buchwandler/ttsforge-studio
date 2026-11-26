use serde::Serialize;
use std::env;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;

#[derive(serde::Deserialize)]
struct RuntimeManifest {
    python: String,
    ttsforge_version: String,
    ttsforge_extra: String,
    static_ffmpeg_version: String,
    api_version: u32,
}

impl RuntimeManifest {
    fn ttsforge_requirement(&self) -> String {
        format!(
            "ttsforge[{}]=={}",
            self.ttsforge_extra, self.ttsforge_version
        )
    }
}

fn runtime_manifest() -> RuntimeManifest {
    toml::from_str(include_str!("../../runtime/runtime-manifest.toml"))
        .expect("runtime manifest must be valid")
}

pub fn api_version() -> u32 {
    runtime_manifest().api_version
}

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
    let manifest = runtime_manifest();
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

    let python_matches = python_version.as_deref().is_some_and(|version| {
        version == manifest.python || version.starts_with(&format!("{}.", manifest.python))
    });
    let installed =
        python_matches && ttsforge_version.as_deref() == Some(manifest.ttsforge_version.as_str());

    let message = if installed {
        "Managed TTSForge runtime is installed.".into()
    } else if let Some(version) = ttsforge_version.as_deref() {
        format!(
            "TTSForge {version} is installed, but {} is required.",
            manifest.ttsforge_version
        )
    } else {
        "Managed Python exists, but TTSForge is not installed.".into()
    };

    RuntimeStatus {
        installed,
        runtime_dir: Some(root.display().to_string()),
        python_version,
        ttsforge_version,
        message,
    }
}

pub fn backend_path(root: &Path) -> Result<OsString, String> {
    let mut paths = vec![root.join("tools")];
    if let Some(path) = env::var_os("PATH") {
        paths.extend(env::split_paths(&path));
    }
    env::join_paths(paths).map_err(|error| format!("Cannot construct backend PATH: {error}"))
}

pub fn remove(app: &AppHandle) -> Result<RuntimeStatus, String> {
    let root = runtime_root(app)?;
    if root.exists() {
        fs::remove_dir_all(&root).map_err(|error| {
            format!("Cannot remove managed runtime {}: {error}", root.display())
        })?;
    }
    Ok(status(app))
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

fn install_media_tools(root: &Path, python: &Path) -> Result<(), String> {
    let output = Command::new(python)
        .args([
            "-c",
            "from static_ffmpeg import run; import json; print(json.dumps(run.get_or_fetch_platform_executables_or_raise()))",
        ])
        .output()
        .map_err(|error| format!("Cannot provision FFmpeg and FFprobe: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "FFmpeg provisioning failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let paths: Vec<PathBuf> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .find_map(|line| serde_json::from_str(line).ok())
        .ok_or_else(|| "FFmpeg provisioning returned no executable paths.".to_string())?;
    if paths.len() != 2 {
        return Err("FFmpeg provisioning did not return both executables.".into());
    }

    copy_media_tools(root, &paths)
}

fn copy_media_tools(root: &Path, paths: &[PathBuf]) -> Result<(), String> {
    let tools = root.join("tools");
    fs::create_dir_all(&tools)
        .map_err(|error| format!("Cannot create managed tools directory: {error}"))?;
    let extension = if cfg!(windows) { ".exe" } else { "" };
    for (source, name) in paths.iter().zip(["ffmpeg", "ffprobe"]) {
        if !source.is_file() {
            return Err(format!(
                "Provisioned executable is missing: {}",
                source.display()
            ));
        }
        let target = tools.join(format!("{name}{extension}"));
        fs::copy(source, &target)
            .map_err(|error| format!("Cannot install {}: {error}", target.display()))?;
    }
    Ok(())
}

pub async fn install(app: &AppHandle) -> Result<RuntimeStatus, String> {
    let manifest = runtime_manifest();
    let root = runtime_root(app)?;
    fs::create_dir_all(&root).map_err(|error| {
        format!(
            "Cannot create runtime directory {}: {error}",
            root.display()
        )
    })?;

    run_uv(
        app,
        &root,
        vec!["python".into(), "install".into(), manifest.python.clone()],
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
            manifest.python.clone(),
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
            manifest.ttsforge_requirement(),
        ],
    )
    .await?;

    run_uv(
        app,
        &root,
        vec![
            "pip".into(),
            "install".into(),
            "--python".into(),
            python.display().to_string(),
            format!("static-ffmpeg=={}", manifest.static_ffmpeg_version),
        ],
    )
    .await?;
    install_media_tools(&root, &python)?;
    let result = status(app);
    if !result.installed {
        return Err("Runtime provisioning finished, but TTSForge could not be verified.".into());
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::{copy_media_tools, runtime_manifest};
    use std::fs;

    #[test]
    fn managed_requirement_comes_from_runtime_manifest() {
        let manifest = runtime_manifest();
        assert_eq!(manifest.python, "3.13");
        assert_eq!(manifest.ttsforge_requirement(), "ttsforge[studio]==0.5.1");
        assert_eq!(manifest.api_version, 1);
        assert_eq!(manifest.static_ffmpeg_version, "3.0");
    }

    #[test]
    fn copies_media_tools_to_managed_tools_directory() {
        let base = std::env::temp_dir().join(format!("ttsforge-tools-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        let ffmpeg = base.join("source-ffmpeg");
        let ffprobe = base.join("source-ffprobe");
        fs::write(&ffmpeg, b"ffmpeg").unwrap();
        fs::write(&ffprobe, b"ffprobe").unwrap();
        let root = base.join("runtime");

        copy_media_tools(&root, &[ffmpeg, ffprobe]).unwrap();

        let extension = if cfg!(windows) { ".exe" } else { "" };
        assert_eq!(
            fs::read(root.join("tools").join(format!("ffmpeg{extension}"))).unwrap(),
            b"ffmpeg"
        );
        assert_eq!(
            fs::read(root.join("tools").join(format!("ffprobe{extension}"))).unwrap(),
            b"ffprobe"
        );
        fs::remove_dir_all(base).unwrap();
    }
}

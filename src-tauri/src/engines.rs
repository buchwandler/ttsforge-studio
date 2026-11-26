use crate::{backend::BackendState, runtime};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager};

const REGISTRY_TEXT: &str = include_str!("../../runtime/engine-registry.toml");
const ENGINE_STATE_FILE: &str = "engine-state.json";
const PROBE_PACKAGES: &str = r#"
import importlib.metadata as metadata
import json
import pathlib
import sys

result = {}
for name in sys.argv[1:]:
    try:
        distribution = metadata.distribution(name)
    except metadata.PackageNotFoundError:
        result[name] = {"installed": False, "version": None, "package_bytes": None}
        continue
    size = 0
    for item in distribution.files or ():
        path = pathlib.Path(distribution.locate_file(item))
        try:
            if path.is_file() and not path.is_symlink():
                size += path.stat().st_size
        except OSError:
            pass
    result[name] = {
        "installed": True,
        "version": distribution.version,
        "package_bytes": size,
    }
print(json.dumps(result))
"#;

const ALLOWED_ENGINE_DISTRIBUTIONS: &[&str] = &[
    "chatterboxsynth",
    "inflectsynth",
    "kittensynth",
    "pykokoro",
    "pipersynth",
    "phononsynth",
    "pocketsynth",
    "qwen3synth",
    "soprosynth",
    "supertonicsynth",
];
const PROTECTED_DISTRIBUTIONS: &[&str] = &[
    "ttsforge",
    "readio",
    "voicerender",
    "fastapi",
    "pydantic",
    "uvicorn",
    "python-multipart",
    "static-ffmpeg",
];

#[derive(Debug, Clone, Deserialize)]
struct EngineRegistryFile {
    schema: u32,
    engine: Vec<EngineRegistryEntry>,
}

#[derive(Debug, Clone, Deserialize)]
struct EngineRegistryEntry {
    id: String,
    label: String,
    distribution: String,
    install_spec: String,
    uninstall_distributions: Vec<String>,
}

#[derive(Debug, Clone)]
struct EngineRegistry {
    engines: Vec<EngineRegistryEntry>,
}

impl EngineRegistry {
    fn parse(value: &str) -> Result<Self, String> {
        let file: EngineRegistryFile = toml::from_str(value)
            .map_err(|error| format!("Invalid bundled engine registry: {error}"))?;
        if file.schema != 1 {
            return Err(format!(
                "Unsupported engine registry schema {}.",
                file.schema
            ));
        }
        if file.engine.is_empty() {
            return Err("The bundled engine registry is empty.".into());
        }

        let mut ids = HashSet::new();
        let mut distributions = HashSet::new();
        for engine in &file.engine {
            if !valid_identifier(&engine.id) || !ids.insert(engine.id.as_str()) {
                return Err(format!("Invalid or duplicate engine ID {:?}.", engine.id));
            }
            if engine.label.trim().is_empty() {
                return Err(format!("Engine {:?} has an empty label.", engine.id));
            }
            if !valid_distribution(&engine.distribution)
                || !ALLOWED_ENGINE_DISTRIBUTIONS.contains(&engine.distribution.as_str())
                || !distributions.insert(engine.distribution.as_str())
            {
                return Err(format!(
                    "Invalid, untrusted, or duplicate distribution {:?}.",
                    engine.distribution
                ));
            }
            if requirement_distribution(&engine.install_spec).as_deref()
                != Some(engine.distribution.as_str())
            {
                return Err(format!(
                    "Engine {:?} install spec does not match its trusted distribution.",
                    engine.id
                ));
            }
            if engine.install_spec.contains([';', '\n', '\r', '\0']) {
                return Err(format!(
                    "Engine {:?} has an invalid install spec.",
                    engine.id
                ));
            }

            let mut uninstall_names = HashSet::new();
            if !engine
                .uninstall_distributions
                .iter()
                .any(|name| name == &engine.distribution)
            {
                return Err(format!(
                    "Engine {:?} does not allow uninstalling its distribution.",
                    engine.id
                ));
            }
            for name in &engine.uninstall_distributions {
                if !valid_distribution(name)
                    || !ALLOWED_ENGINE_DISTRIBUTIONS.contains(&name.as_str())
                    || PROTECTED_DISTRIBUTIONS.contains(&name.as_str())
                    || !uninstall_names.insert(name.as_str())
                {
                    return Err(format!(
                        "Engine {:?} has an invalid or protected uninstall distribution {:?}.",
                        engine.id, name
                    ));
                }
            }
        }

        Ok(Self {
            engines: file.engine,
        })
    }

    fn bundled() -> Self {
        Self::parse(REGISTRY_TEXT).expect("bundled engine registry must be valid")
    }

    fn get(&self, engine_id: &str) -> Result<&EngineRegistryEntry, String> {
        self.engines
            .iter()
            .find(|engine| engine.id == engine_id)
            .ok_or_else(|| format!("Unsupported engine ID {engine_id:?}."))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EngineAction {
    Install,
    Update,
    Repair,
    Remove,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EnginePackageState {
    NotInstalled,
    Ready,
    Incompatible,
    Broken,
    Unknown,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EngineUpdateState {
    Current,
    UpdateAvailable,
    Unavailable,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnginePackageStatus {
    pub engine_id: String,
    pub label: String,
    pub distribution: String,
    pub installed: bool,
    pub installed_version: Option<String>,
    pub supported_requirement: Option<String>,
    pub available_version: Option<String>,
    pub update_state: EngineUpdateState,
    pub package_bytes: Option<u64>,
    pub catalog_installed: Option<bool>,
    pub catalog_runnable: Option<bool>,
    pub catalog_reason: Option<String>,
    pub state: EnginePackageState,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineMutationResult {
    pub status: EnginePackageStatus,
    pub package_mutation_succeeded: bool,
    pub backend_was_running: bool,
    pub backend_restarted: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct PackageProbe {
    installed: bool,
    version: Option<String>,
    package_bytes: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct EngineCatalogEntry {
    id: String,
    installed: bool,
    runnable: bool,
    reason: Option<String>,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesiredEngineState {
    schema: u32,
    enabled_engines: Vec<String>,
}

#[derive(Default)]
pub struct RuntimeMutationGate {
    active: AtomicBool,
}

pub struct RuntimeMutationGuard<'a> {
    gate: &'a RuntimeMutationGate,
}

impl RuntimeMutationGate {
    pub fn acquire(&self) -> Result<RuntimeMutationGuard<'_>, String> {
        self.active
            .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .map_err(|_| "Another runtime or engine mutation is already active.".to_string())?;
        Ok(RuntimeMutationGuard { gate: self })
    }
}

impl Drop for RuntimeMutationGuard<'_> {
    fn drop(&mut self) {
        self.gate.active.store(false, Ordering::Release);
    }
}

pub fn status(
    app: &AppHandle,
    backend: &mut BackendState,
) -> Result<Vec<EnginePackageStatus>, String> {
    let registry = EngineRegistry::bundled();
    let root = runtime::runtime_root(app)?;
    let python = runtime::venv_python(&root);
    let probes = if python.is_file() {
        probe_packages(&python, &registry)?
    } else {
        HashMap::new()
    };
    let (catalog, catalog_error) = match backend.engine_catalog() {
        Ok(catalog) => (catalog, None),
        Err(error) => (None, Some(error)),
    };
    let catalog_available = catalog.is_some();
    let catalog = catalog
        .map(|value| serde_json::from_value::<Vec<EngineCatalogEntry>>(value))
        .transpose()
        .map_err(|error| format!("TTSForge returned an invalid engine catalog: {error}"))?
        .unwrap_or_default();

    Ok(registry
        .engines
        .iter()
        .map(|engine| {
            let probe = probes
                .get(&engine.distribution)
                .cloned()
                .unwrap_or_default();
            let missing_entry = EngineCatalogEntry {
                id: engine.id.clone(),
                installed: false,
                runnable: false,
                reason: Some("The TTSForge catalog does not list this engine.".into()),
            };
            let catalog_entry = catalog
                .iter()
                .find(|entry| entry.id == engine.id)
                .or_else(|| catalog_available.then_some(&missing_entry));
            package_status(engine, probe, catalog_entry, catalog_error.as_deref())
        })
        .collect())
}
pub fn validate_engine_id(engine_id: &str) -> Result<(), String> {
    EngineRegistry::bundled().get(engine_id).map(|_| ())
}

pub async fn mutate(app: &AppHandle, engine_id: &str, action: EngineAction) -> Result<(), String> {
    let registry = EngineRegistry::bundled();
    let engine = registry.get(engine_id)?;
    let root = runtime::runtime_root(app)?;
    let python = runtime::venv_python(&root);
    if !python.is_file() {
        return Err("Install the managed runtime before managing engines.".into());
    }

    let state_path = desired_state_path(app)?;
    let mut desired = load_desired_state(&state_path, &registry)?;
    let before = probe_packages(&python, &registry)?;
    let installed = before
        .get(&engine.distribution)
        .is_some_and(|probe| probe.installed);

    let args = match action {
        EngineAction::Install => install_args(&python, &engine.install_spec),
        EngineAction::Update => update_args(&python, &engine.install_spec),
        EngineAction::Repair => repair_args(&python, &engine.install_spec),
        EngineAction::Remove if installed => uninstall_args(&python, engine),
        EngineAction::Remove => Vec::new(),
    };
    if !args.is_empty() {
        runtime::run_uv(app, &root, args).await?;
    }

    let after = probe_packages(&python, &registry)?;
    let is_installed = after
        .get(&engine.distribution)
        .is_some_and(|probe| probe.installed);
    match action {
        EngineAction::Remove if is_installed => {
            return Err(format!(
                "The {} distribution is still installed after removal.",
                engine.distribution
            ));
        }
        EngineAction::Install | EngineAction::Update | EngineAction::Repair if !is_installed => {
            return Err(format!(
                "uv completed, but the {} distribution could not be verified.",
                engine.distribution
            ));
        }
        _ => {}
    }

    match action {
        EngineAction::Install => {
            if !desired.enabled_engines.iter().any(|id| id == engine_id) {
                desired.enabled_engines.push(engine_id.to_string());
                desired.enabled_engines.sort();
                save_desired_state(&state_path, &desired)?;
            }
        }
        EngineAction::Remove => {
            let retained = desired
                .enabled_engines
                .iter()
                .filter(|id| id.as_str() != engine_id)
                .cloned()
                .collect::<Vec<_>>();
            if retained != desired.enabled_engines {
                desired.enabled_engines = retained;
                save_desired_state(&state_path, &desired)?;
            }
        }
        EngineAction::Update | EngineAction::Repair => {}
    }
    Ok(())
}

pub async fn reinstall_desired(app: &AppHandle) -> Result<(), String> {
    let registry = EngineRegistry::bundled();
    let state_path = desired_state_path(app)?;
    let desired = load_desired_state(&state_path, &registry)?;
    for engine_id in desired.enabled_engines {
        mutate(app, &engine_id, EngineAction::Install).await?;
    }
    Ok(())
}

pub fn clear_desired(app: &AppHandle) -> Result<(), String> {
    let path = desired_state_path(app)?;
    save_desired_state(
        &path,
        &DesiredEngineState {
            schema: 1,
            enabled_engines: Vec::new(),
        },
    )
}

pub fn status_for_mutation(
    app: &AppHandle,
    backend: &mut BackendState,
    engine_id: &str,
    backend_was_running: bool,
    backend_restarted: bool,
    message: Option<String>,
) -> Result<EngineMutationResult, String> {
    let status = status(app, backend)?
        .into_iter()
        .find(|status| status.engine_id == engine_id)
        .ok_or_else(|| format!("Engine {engine_id:?} is missing from the bundled registry."))?;
    Ok(EngineMutationResult {
        status,
        package_mutation_succeeded: true,
        backend_was_running,
        backend_restarted,
        message,
    })
}

fn package_status(
    engine: &EngineRegistryEntry,
    probe: PackageProbe,
    catalog: Option<&EngineCatalogEntry>,
    catalog_error: Option<&str>,
) -> EnginePackageStatus {
    let state = if !probe.installed {
        EnginePackageState::NotInstalled
    } else if let Some(catalog) = catalog {
        if catalog.runnable {
            EnginePackageState::Ready
        } else if catalog
            .reason
            .as_deref()
            .is_some_and(|reason| reason.to_ascii_lowercase().contains("incompat"))
        {
            EnginePackageState::Incompatible
        } else {
            EnginePackageState::Broken
        }
    } else {
        EnginePackageState::Unknown
    };
    let message = match &state {
        EnginePackageState::NotInstalled => Some("Engine package is not installed.".into()),
        EnginePackageState::Ready => None,
        EnginePackageState::Incompatible | EnginePackageState::Broken => catalog
            .and_then(|entry| entry.reason.clone())
            .or_else(|| Some("The installed engine is not runnable.".into())),
        EnginePackageState::Unknown => Some(
            catalog_error
                .map(|error| format!("The engine catalog could not be refreshed: {error}"))
                .unwrap_or_else(|| "Start the TTSForge backend to check engine readiness.".into()),
        ),
    };

    EnginePackageStatus {
        engine_id: engine.id.clone(),
        label: engine.label.clone(),
        distribution: engine.distribution.clone(),
        installed: probe.installed,
        installed_version: probe.version,
        supported_requirement: Some(engine.install_spec.clone()),
        available_version: None,
        update_state: EngineUpdateState::Unknown,
        package_bytes: probe.package_bytes,
        catalog_installed: catalog.map(|entry| entry.installed),
        catalog_runnable: catalog.map(|entry| entry.runnable),
        catalog_reason: catalog.and_then(|entry| entry.reason.clone()),
        state,
        message,
    }
}

fn probe_packages(
    python: &Path,
    registry: &EngineRegistry,
) -> Result<HashMap<String, PackageProbe>, String> {
    let distributions = registry
        .engines
        .iter()
        .map(|engine| engine.distribution.as_str())
        .collect::<Vec<_>>();
    let output = Command::new(python)
        .arg("-c")
        .arg(PROBE_PACKAGES)
        .args(&distributions)
        .output()
        .map_err(|error| format!("Cannot inspect managed engine packages: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Managed Python package probe failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("Managed Python package probe returned invalid JSON: {error}"))
}

fn desired_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Cannot resolve application data directory: {error}"))?
        .join(ENGINE_STATE_FILE))
}

fn load_desired_state(
    path: &Path,
    registry: &EngineRegistry,
) -> Result<DesiredEngineState, String> {
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(DesiredEngineState {
                schema: 1,
                enabled_engines: Vec::new(),
            });
        }
        Err(error) => return Err(format!("Cannot read engine preferences: {error}")),
    };
    let state: DesiredEngineState = serde_json::from_str(&content)
        .map_err(|error| format!("Cannot parse engine preferences: {error}"))?;
    if state.schema != 1 {
        return Err(format!(
            "Unsupported engine preference schema {}.",
            state.schema
        ));
    }
    let mut seen = HashSet::new();
    for engine_id in &state.enabled_engines {
        registry.get(engine_id)?;
        if !seen.insert(engine_id) {
            return Err(format!("Duplicate engine preference {engine_id:?}."));
        }
    }
    Ok(state)
}

fn save_desired_state(path: &Path, state: &DesiredEngineState) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Engine preferences have no parent directory.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Cannot create engine preference directory: {error}"))?;
    let temporary = path.with_extension(format!("json.{}.tmp", std::process::id()));
    let serialized = serde_json::to_vec_pretty(state)
        .map_err(|error| format!("Cannot serialize engine preferences: {error}"))?;
    fs::write(&temporary, serialized)
        .map_err(|error| format!("Cannot write engine preferences: {error}"))?;
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("Cannot replace engine preferences: {error}"))?;
    }
    fs::rename(&temporary, path).map_err(|error| format!("Cannot save engine preferences: {error}"))
}

fn install_args(python: &Path, install_spec: &str) -> Vec<String> {
    vec![
        "pip".into(),
        "install".into(),
        "--python".into(),
        python.display().to_string(),
        install_spec.into(),
    ]
}

fn update_args(python: &Path, install_spec: &str) -> Vec<String> {
    vec![
        "pip".into(),
        "install".into(),
        "--upgrade".into(),
        "--python".into(),
        python.display().to_string(),
        install_spec.into(),
    ]
}

fn repair_args(python: &Path, install_spec: &str) -> Vec<String> {
    vec![
        "pip".into(),
        "install".into(),
        "--reinstall".into(),
        "--python".into(),
        python.display().to_string(),
        install_spec.into(),
    ]
}

fn uninstall_args(python: &Path, engine: &EngineRegistryEntry) -> Vec<String> {
    let mut args = vec![
        "pip".into(),
        "uninstall".into(),
        "--python".into(),
        python.display().to_string(),
    ];
    args.extend(engine.uninstall_distributions.iter().cloned());
    args
}

fn requirement_distribution(requirement: &str) -> Option<String> {
    let end = requirement
        .find(['[', '<', '>', '=', '!', '~', ';', ' ', '\n', '\r'])
        .unwrap_or(requirement.len());
    let name = requirement.get(..end)?;
    valid_distribution(name).then(|| name.to_string())
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"-_".contains(&byte))
}

fn valid_distribution(value: &str) -> bool {
    !value.is_empty()
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"-_.".contains(&byte)
        })
}

#[cfg(test)]
mod tests {
    use super::{
        install_args, package_status, repair_args, uninstall_args, update_args, DesiredEngineState,
        EngineAction, EnginePackageState, EngineRegistry, PackageProbe, RuntimeMutationGate,
    };
    use serde_json::json;
    use std::fs;
    use std::path::Path;

    const SINGLE_ENGINE: &str = r#"
schema = 1
[[engine]]
id = "kitten"
label = "Kitten"
distribution = "kittensynth"
install_spec = "kittensynth[cpu]>=0.1.9,<0.2"
uninstall_distributions = ["kittensynth"]
"#;

    #[test]
    fn bundled_registry_has_unique_trusted_engine_entries() {
        let registry = EngineRegistry::bundled();
        assert_eq!(registry.engines.len(), 10);
        assert!(registry.get("kitten").is_ok());
        assert!(registry.get("unsupported").is_err());
    }

    #[test]
    fn registry_rejects_duplicate_engine_ids_and_untrusted_distributions() {
        let duplicate = SINGLE_ENGINE.replace(
            "[[engine]]\nid = \"kitten\"",
            "[[engine]]\nid = \"kitten\"\nlabel = \"Kitten 2\"\ndistribution = \"kittensynth\"\ninstall_spec = \"kittensynth[cpu]>=0.1.9,<0.2\"\nuninstall_distributions = [\"kittensynth\"]\n\n[[engine]]\nid = \"kitten\"",
        );
        assert!(EngineRegistry::parse(&duplicate).is_err());
        assert!(EngineRegistry::parse(&SINGLE_ENGINE.replace("kittensynth", "readio")).is_err());
    }

    #[test]
    fn registry_rejects_install_specs_that_do_not_match_the_allowlisted_distribution() {
        let value =
            SINGLE_ENGINE.replace("kittensynth[cpu]>=0.1.9,<0.2", "pykokoro>=0.10.13,<0.11");
        assert!(EngineRegistry::parse(&value).is_err());
    }

    #[test]
    fn registry_rejects_uninstalling_runtime_dependencies() {
        let value = SINGLE_ENGINE.replace(
            "uninstall_distributions = [\"kittensynth\"]",
            "uninstall_distributions = [\"kittensynth\", \"readio\"]",
        );
        assert!(EngineRegistry::parse(&value).is_err());
    }

    #[test]
    fn package_commands_use_only_registry_data_and_the_managed_python() {
        let python = Path::new("runtime/venv/bin/python");
        let registry = EngineRegistry::parse(SINGLE_ENGINE).unwrap();
        let engine = registry.get("kitten").unwrap();
        assert_eq!(
            install_args(python, &engine.install_spec),
            [
                "pip",
                "install",
                "--python",
                "runtime/venv/bin/python",
                "kittensynth[cpu]>=0.1.9,<0.2"
            ]
        );
        assert_eq!(
            update_args(python, &engine.install_spec),
            [
                "pip",
                "install",
                "--upgrade",
                "--python",
                "runtime/venv/bin/python",
                "kittensynth[cpu]>=0.1.9,<0.2"
            ]
        );
        assert_eq!(
            repair_args(python, &engine.install_spec),
            [
                "pip",
                "install",
                "--reinstall",
                "--python",
                "runtime/venv/bin/python",
                "kittensynth[cpu]>=0.1.9,<0.2"
            ]
        );
        assert_eq!(
            uninstall_args(python, engine),
            [
                "pip",
                "uninstall",
                "--python",
                "runtime/venv/bin/python",
                "kittensynth"
            ]
        );
    }

    #[test]
    fn package_status_requires_catalog_runnable_state() {
        let registry = EngineRegistry::parse(SINGLE_ENGINE).unwrap();
        let engine = registry.get("kitten").unwrap();
        let missing = package_status(engine, PackageProbe::default(), None, None);
        assert!(matches!(missing.state, EnginePackageState::NotInstalled));
        let catalog = serde_json::from_value(json!({
            "id": "kitten",
            "installed": true,
            "runnable": false,
            "reason": "Runtime is incompatible"
        }))
        .unwrap();
        let broken = package_status(
            engine,
            PackageProbe {
                installed: true,
                version: Some("0.1.9".into()),
                package_bytes: Some(2048),
            },
            Some(&catalog),
            None,
        );
        assert!(matches!(broken.state, EnginePackageState::Incompatible));
        assert_eq!(broken.package_bytes, Some(2048));
    }

    #[test]
    fn desired_state_is_persisted_outside_the_runtime_and_validated() {
        let root = std::env::temp_dir().join(format!("ttsforge-engines-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let path = root.join("engine-state.json");
        let registry = EngineRegistry::parse(SINGLE_ENGINE).unwrap();
        let state = DesiredEngineState {
            schema: 1,
            enabled_engines: vec!["kitten".into()],
        };
        super::save_desired_state(&path, &state).unwrap();
        assert_eq!(
            super::load_desired_state(&path, &registry)
                .unwrap()
                .enabled_engines,
            ["kitten"]
        );
        assert!(super::load_desired_state(
            &path,
            &EngineRegistry::parse(&SINGLE_ENGINE.replace("id = \"kitten\"", "id = \"other\""))
                .unwrap()
        )
        .is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn runtime_mutation_gate_allows_only_one_mutation() {
        let gate = RuntimeMutationGate::default();
        let guard = gate.acquire().unwrap();
        assert!(gate.acquire().is_err());
        drop(guard);
        assert!(gate.acquire().is_ok());
    }

    #[test]
    fn operation_enum_keeps_all_native_mutations_explicit() {
        assert_eq!(EngineAction::Install, EngineAction::Install);
        assert_eq!(EngineAction::Update, EngineAction::Update);
        assert_eq!(EngineAction::Repair, EngineAction::Repair);
        assert_eq!(EngineAction::Remove, EngineAction::Remove);
    }
}

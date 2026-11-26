use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use tauri::AppHandle;
use uuid::Uuid;

use crate::runtime;

const LOG_LIMIT: u64 = 5 * 1024 * 1024;
const LOG_RETENTION: usize = 4;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(20);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendInfo {
    pub base_url: String,
    pub token: String,
    pub api_version: u32,
    pub runtime_ready: bool,
    pub runtime_problems: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ReadyRecord {
    #[serde(rename = "type")]
    kind: String,
    host: String,
    port: u16,
    api_version: u32,
}

struct RotatingLog {
    path: PathBuf,
    file: Option<File>,
}

impl RotatingLog {
    fn open(path: PathBuf) -> std::io::Result<Self> {
        let file = OpenOptions::new().create(true).append(true).open(&path)?;
        Ok(Self {
            path,
            file: Some(file),
        })
    }

    fn write_line(&mut self, line: &str) -> std::io::Result<()> {
        let mut bytes = format!("{line}\n").into_bytes();
        if bytes.len() > LOG_LIMIT as usize {
            bytes.truncate(LOG_LIMIT as usize - 1);
            bytes.push(b'\n');
        }
        let size = fs::metadata(&self.path)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        if size > 0 && size + bytes.len() as u64 > LOG_LIMIT {
            self.rotate()?;
        }
        self.file
            .as_mut()
            .expect("log file is open")
            .write_all(&bytes)
    }

    fn rotate(&mut self) -> std::io::Result<()> {
        if let Some(mut file) = self.file.take() {
            file.flush()?;
        }
        for index in (1..=LOG_RETENTION).rev() {
            let source = rotated_path(&self.path, index);
            if index == LOG_RETENTION {
                if source.exists() {
                    fs::remove_file(source)?;
                }
            } else if source.exists() {
                fs::rename(&source, rotated_path(&self.path, index + 1))?;
            }
        }
        if self.path.exists() {
            fs::rename(&self.path, rotated_path(&self.path, 1))?;
        }
        self.file = Some(
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.path)?,
        );
        Ok(())
    }
}

fn rotated_path(path: &Path, index: usize) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(format!(".{index}"));
    PathBuf::from(name)
}

fn log_line(log: &Arc<Mutex<RotatingLog>>, stream: &str, line: &str, token: &str) {
    let line = if token.is_empty() {
        line.to_owned()
    } else {
        line.replace(token, "[REDACTED]")
    };
    if let Ok(mut log) = log.lock() {
        let _ = log.write_line(&format!("[{stream}] {line}"));
    }
}

fn spawn_reader<R: Read + Send + 'static>(
    reader: R,
    stream: &'static str,
    token: String,
    log: Arc<Mutex<RotatingLog>>,
    readiness: Option<mpsc::Sender<String>>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            log_line(&log, stream, &line, &token);
            if let Some(readiness) = &readiness {
                let _ = readiness.send(line);
            }
        }
    })
}

fn parse_ready_record(line: &str) -> Result<Option<ReadyRecord>, String> {
    let value: Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };
    if value.get("type").and_then(Value::as_str) != Some("server.ready") {
        return Ok(None);
    }
    let record: ReadyRecord = serde_json::from_value(value)
        .map_err(|error| format!("Invalid TTSForge readiness record: {error}"))?;
    if record.kind != "server.ready" || record.host != "127.0.0.1" || record.port == 0 {
        return Err("TTSForge readiness record has an invalid host or port.".into());
    }
    Ok(Some(record))
}

fn validate_api_version(actual: u32, expected: u32) -> Result<(), String> {
    if actual != expected {
        return Err(format!(
            "Desktop expects TTSForge API v{expected}, but the managed backend reported API v{actual}. Repair the managed runtime."
        ));
    }
    Ok(())
}

fn dev_origin() -> Result<String, String> {
    let host = env::var("TAURI_DEV_HOST").unwrap_or_else(|_| "localhost".into());
    dev_origin_from_host(&host)
}

fn dev_origin_from_host(host: &str) -> Result<String, String> {
    if host.is_empty() || host.contains("://") || host.contains('/') || host.contains(' ') {
        return Err("TAURI_DEV_HOST must be a host name without a scheme or path.".into());
    }
    Ok(format!("http://{host}:1420"))
}

fn server_args(state_root: &Path, token: &str, origin: Option<&str>) -> Vec<String> {
    let mut args = vec![
        "-m".into(),
        "ttsforge.server".into(),
        "--host".into(),
        "127.0.0.1".into(),
        "--port".into(),
        "0".into(),
        "--token".into(),
        token.into(),
        "--state-dir".into(),
        state_root.display().to_string(),
    ];
    if let Some(origin) = origin {
        args.push("--allow-origin".into());
        args.push(origin.into());
    }
    args
}

fn authenticated_get(port: u16, token: &str, path: &str) -> Result<Value, String> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(2))
        .map_err(|error| format!("Cannot connect to the managed TTSForge API: {error}"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| format!("Cannot set API read timeout: {error}"))?;
    write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n"
    )
    .map_err(|error| format!("Cannot request TTSForge API readiness: {error}"))?;
    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .map_err(|error| format!("Cannot read TTSForge API response: {error}"))?;
    let separator = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| "TTSForge API returned an invalid HTTP response.".to_string())?;
    let headers = String::from_utf8_lossy(&response[..separator]);
    let status = headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|status| status.parse::<u16>().ok())
        .ok_or_else(|| "TTSForge API returned an invalid HTTP status.".to_string())?;
    if status != 200 {
        return Err(format!(
            "TTSForge API readiness request failed with HTTP {status}."
        ));
    }
    serde_json::from_slice(&response[separator + 4..])
        .map_err(|error| format!("TTSForge API returned invalid JSON: {error}"))
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
    #[cfg(target_os = "linux")]
    {
        let parent_pid = unsafe { libc::getpid() };
        unsafe {
            command.pre_exec(move || {
                if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM) == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                if libc::getppid() != parent_pid {
                    libc::kill(libc::getpid(), libc::SIGTERM);
                }
                Ok(())
            });
        }
    }
}

#[cfg(windows)]
fn configure_process_group(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x00000200);
}

#[cfg(not(any(unix, windows)))]
fn configure_process_group(_: &mut Command) {}

#[cfg(unix)]
fn signal_process_tree(pid: u32, signal: i32) {
    unsafe {
        libc::kill(-(pid as i32), signal);
    }
}

#[cfg(windows)]
fn kill_process_tree(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .status();
}

#[cfg(not(windows))]
fn kill_process_tree(pid: u32) {
    let _ = pid;
}

fn terminate_child(child: &mut Child, log: &Arc<Mutex<RotatingLog>>, token: &str) {
    let pid = child.id();
    log_line(log, "supervisor", "Requesting backend shutdown.", token);
    #[cfg(unix)]
    signal_process_tree(pid, libc::SIGTERM);
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T"])
            .status();
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = child.kill();
    }

    let deadline = Instant::now() + SHUTDOWN_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                log_line(log, "supervisor", "Backend exited cleanly.", token);
                return;
            }
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(50)),
            _ => break,
        }
    }

    log_line(
        log,
        "supervisor",
        "Backend shutdown timed out; terminating its process tree.",
        token,
    );
    #[cfg(unix)]
    signal_process_tree(pid, libc::SIGKILL);
    kill_process_tree(pid);
    let _ = child.kill();
    let _ = child.wait();
}

fn wait_for_ready(
    child: &mut Child,
    readiness: &mpsc::Receiver<String>,
    timeout: Duration,
) -> Result<ReadyRecord, String> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("Cannot inspect TTSForge backend startup: {error}"))?
        {
            return Err(format!(
                "TTSForge backend exited during startup with status {status}."
            ));
        }
        match readiness.recv_timeout(Duration::from_millis(100)) {
            Ok(line) => {
                if let Some(record) = parse_ready_record(&line)? {
                    return Ok(record);
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err("TTSForge backend closed its readiness stream during startup.".into());
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        if Instant::now() >= deadline {
            return Err(
                "TTSForge backend did not emit a readiness record before the startup timeout."
                    .into(),
            );
        }
    }
}

fn runtime_problems(value: &Value) -> Vec<String> {
    value
        .get("problems")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|problem| {
            problem
                .get("message")
                .and_then(Value::as_str)
                .or_else(|| problem.get("code").and_then(Value::as_str))
                .map(str::to_owned)
        })
        .collect()
}

#[derive(Default)]
pub struct BackendState {
    child: Option<Child>,
    info: Option<BackendInfo>,
    log: Option<Arc<Mutex<RotatingLog>>>,
    readers: Vec<JoinHandle<()>>,
}

impl BackendState {
    pub fn info_if_running(&mut self) -> Option<BackendInfo> {
        let child = self.child.as_mut()?;
        match child.try_wait() {
            Ok(None) => self.info.clone(),
            Ok(Some(status)) => {
                if let Some(log) = &self.log {
                    log_line(
                        log,
                        "supervisor",
                        &format!("Backend exited with {status}."),
                        "",
                    );
                }
                self.child = None;
                self.info = None;
                self.join_readers();
                None
            }
            Err(error) => {
                if let Some(log) = &self.log {
                    log_line(
                        log,
                        "supervisor",
                        &format!("Cannot inspect backend process: {error}"),
                        "",
                    );
                }
                self.child = None;
                self.info = None;
                self.join_readers();
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
            return Err(runtime_status.message);
        }
        let runtime_root = runtime::runtime_root(app)?;
        let python = runtime::venv_python(&runtime_root);
        let state_root = runtime::server_state_root(app)?;
        let logs = state_root.join("logs");
        fs::create_dir_all(&logs)
            .map_err(|error| format!("Cannot create backend log directory: {error}"))?;
        let token = Uuid::new_v4().to_string();
        let logger = Arc::new(Mutex::new(
            RotatingLog::open(logs.join("backend.log"))
                .map_err(|error| format!("Cannot open backend log: {error}"))?,
        ));
        let origin = if cfg!(debug_assertions) {
            Some(dev_origin()?)
        } else {
            None
        };
        let mut command = Command::new(&python);
        command
            .args(server_args(&state_root, &token, origin.as_deref()))
            .env("TTSFORGE_STUDIO", "1")
            .env("PATH", runtime::backend_path(&runtime_root)?)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        configure_process_group(&mut command);

        let mut child = command
            .spawn()
            .map_err(|error| format!("Cannot start TTSForge backend: {error}"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Cannot capture TTSForge backend readiness output.".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Cannot capture TTSForge backend diagnostics.".to_string())?;
        let (readiness_tx, readiness_rx) = mpsc::channel();
        let mut readers = vec![spawn_reader(
            stdout,
            "stdout",
            token.clone(),
            logger.clone(),
            Some(readiness_tx),
        )];
        readers.push(spawn_reader(
            stderr,
            "stderr",
            token.clone(),
            logger.clone(),
            None,
        ));

        let startup = (|| {
            let ready = wait_for_ready(&mut child, &readiness_rx, STARTUP_TIMEOUT)?;
            validate_api_version(ready.api_version, runtime::api_version())?;
            let system = authenticated_get(ready.port, &token, "/api/v1/system")?;
            let system_version = system
                .get("api_version")
                .and_then(Value::as_u64)
                .ok_or_else(|| "TTSForge system response omitted api_version.".to_string())?
                as u32;
            validate_api_version(system_version, runtime::api_version())?;
            if !system.get("capabilities").is_some_and(Value::is_object) {
                return Err("TTSForge system response omitted capabilities.".into());
            }
            let runtime = authenticated_get(ready.port, &token, "/api/v1/system/runtime")?;
            let runtime_ready = runtime
                .get("ready")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let problems = runtime_problems(&runtime);
            let info = BackendInfo {
                base_url: format!("http://127.0.0.1:{}", ready.port),
                token: token.clone(),
                api_version: ready.api_version,
                runtime_ready,
                runtime_problems: problems,
            };
            Ok(info)
        })();

        match startup {
            Ok(info) => {
                self.child = Some(child);
                self.info = Some(info.clone());
                self.log = Some(logger);
                self.readers = readers;
                Ok(info)
            }
            Err(error) => {
                terminate_child(&mut child, &logger, &token);
                for reader in readers {
                    let _ = reader.join();
                }
                Err(error)
            }
        }
    }

    pub fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            if let Some(log) = &self.log {
                let token = self
                    .info
                    .as_ref()
                    .map(|info| info.token.as_str())
                    .unwrap_or("");
                terminate_child(&mut child, log, token);
            } else {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        self.info = None;
        self.join_readers();
        self.log = None;
    }

    fn join_readers(&mut self) {
        for reader in self.readers.drain(..) {
            let _ = reader.join();
        }
    }
}

impl Drop for BackendState {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    use super::terminate_child;
    use super::{
        authenticated_get, configure_process_group, dev_origin_from_host, log_line,
        parse_ready_record, runtime_problems, server_args, validate_api_version, wait_for_ready,
        RotatingLog, LOG_LIMIT,
    };
    use serde_json::json;
    use std::fs;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::process::{Child, Command, Stdio};
    #[cfg(target_os = "linux")]
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{mpsc, Arc, Mutex};
    use std::thread;
    use std::time::Duration;

    #[cfg(target_os = "linux")]
    static PARENT_DIED: AtomicBool = AtomicBool::new(false);

    #[cfg(target_os = "linux")]
    extern "C" fn mark_parent_died(_: libc::c_int) {
        PARENT_DIED.store(true, Ordering::Relaxed);
    }

    #[test]
    fn parses_server_readiness_record() {
        let record = parse_ready_record(
            r#"{"type":"server.ready","host":"127.0.0.1","port":54321,"api_version":1}"#,
        )
        .unwrap()
        .unwrap();
        assert_eq!(record.port, 54321);
        assert_eq!(record.api_version, 1);
    }

    #[test]
    fn ignores_unrelated_and_malformed_lines() {
        assert!(parse_ready_record("startup message").unwrap().is_none());
        assert!(parse_ready_record(r#"{"type":"other"}"#).unwrap().is_none());
    }

    #[test]
    fn rejects_incomplete_readiness_record() {
        assert!(parse_ready_record(r#"{"type":"server.ready","host":"127.0.0.1"}"#).is_err());
    }

    #[test]
    fn rejects_wrong_api_major() {
        assert!(validate_api_version(2, 1).unwrap_err().contains("API v2"));
    }

    #[test]
    fn authenticated_probe_sends_the_bearer_token() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 2048];
            let length = stream.read(&mut request).unwrap();
            let request = String::from_utf8_lossy(&request[..length]);
            assert!(request.contains("Authorization: Bearer secret-token"));
            let body = r#"{"api_version":1,"capabilities":{}}"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        });

        let response = authenticated_get(port, "secret-token", "/api/v1/system").unwrap();
        assert_eq!(response["api_version"], 1);
        server.join().unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn gracefully_terminates_backend_process_group() {
        let mut child = spawn_fixture("sleep");
        thread::sleep(Duration::from_millis(100));
        let path = std::env::temp_dir().join(format!("ttsforge-stop-{}", std::process::id()));
        let log = Arc::new(Mutex::new(RotatingLog::open(path.clone()).unwrap()));

        terminate_child(&mut child, &log, "secret-token");

        assert!(child.try_wait().unwrap().is_some());
        drop(log);
        let _ = fs::remove_file(path);
    }

    #[cfg(unix)]
    #[test]
    fn forcefully_terminates_backend_that_ignores_sigterm() {
        let mut child = spawn_fixture("ignore-term");
        let ready = std::env::temp_dir().join(format!(
            "ttsforge-fixture-ready-{}-ignore-term",
            std::process::id()
        ));
        for _ in 0..100 {
            if ready.exists() {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        assert!(ready.exists());
        let path = std::env::temp_dir().join(format!("ttsforge-force-{}", std::process::id()));
        let log = Arc::new(Mutex::new(RotatingLog::open(path.clone()).unwrap()));

        terminate_child(&mut child, &log, "secret-token");

        assert!(!child.try_wait().unwrap().unwrap().success());
        drop(log);
        let _ = fs::remove_file(path);
        let _ = fs::remove_file(ready);
    }

    #[test]
    fn detects_backend_exit_before_readiness() {
        let mut child = spawn_fixture("exit");
        thread::sleep(Duration::from_millis(50));
        let (_sender, readiness) = mpsc::channel();
        let error = wait_for_ready(&mut child, &readiness, Duration::from_secs(1)).unwrap_err();
        assert!(error.contains("exited during startup"));
    }

    #[test]
    fn times_out_backend_readiness() {
        let mut child = spawn_fixture("sleep");
        let (_sender, readiness) = mpsc::channel();
        let error = wait_for_ready(&mut child, &readiness, Duration::from_millis(10)).unwrap_err();
        child.kill().unwrap();
        child.wait().unwrap();
        assert!(error.contains("startup timeout"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn backend_child_exits_when_supervisor_process_dies() {
        let ready =
            std::env::temp_dir().join(format!("ttsforge-pdeath-ready-{}", std::process::id()));
        let stopped =
            std::env::temp_dir().join(format!("ttsforge-pdeath-stopped-{}", std::process::id()));
        let pid_path =
            std::env::temp_dir().join(format!("ttsforge-pdeath-pid-{}", std::process::id()));
        let _ = fs::remove_file(&ready);
        let _ = fs::remove_file(&stopped);
        let _ = fs::remove_file(&pid_path);

        let mut parent = Command::new(std::env::current_exe().unwrap());
        parent
            .args(["--exact", "backend::tests::process_fixture"])
            .env("TTSFORGE_BACKEND_TEST_FIXTURE", "spawn-parent-death-child")
            .env("TTSFORGE_BACKEND_TEST_CHILD_READY", &ready)
            .env("TTSFORGE_BACKEND_TEST_CHILD_STOPPED", &stopped)
            .env("TTSFORGE_BACKEND_TEST_CHILD_PID", &pid_path)
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        configure_process_group(&mut parent);
        let mut parent = parent.spawn().unwrap();

        for _ in 0..200 {
            if ready.exists() || parent.try_wait().unwrap().is_some() {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        assert!(ready.exists(), "supervised fixture did not become ready");
        assert!(parent.wait().unwrap().success());

        for _ in 0..100 {
            if stopped.exists() {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        let child_stopped = stopped.exists();
        if !child_stopped {
            if let Ok(pid) = fs::read_to_string(&pid_path) {
                if let Ok(pid) = pid.parse::<i32>() {
                    unsafe { libc::kill(pid, libc::SIGKILL) };
                }
            }
        }
        assert!(child_stopped, "backend child survived its supervisor");
        let _ = fs::remove_file(ready);
        let _ = fs::remove_file(stopped);
        let _ = fs::remove_file(pid_path);
    }

    fn spawn_fixture(mode: &str) -> Child {
        let ready = std::env::temp_dir().join(format!(
            "ttsforge-fixture-ready-{}-{mode}",
            std::process::id()
        ));
        let _ = fs::remove_file(&ready);
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args(["--exact", "backend::tests::process_fixture"])
            .env("TTSFORGE_BACKEND_TEST_FIXTURE", mode)
            .env("TTSFORGE_BACKEND_TEST_FIXTURE_READY", ready)
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        configure_process_group(&mut command);
        command.spawn().unwrap()
    }

    #[test]
    fn process_fixture() {
        match std::env::var("TTSFORGE_BACKEND_TEST_FIXTURE").as_deref() {
            Ok("sleep") => thread::sleep(Duration::from_secs(10)),
            #[cfg(unix)]
            Ok("ignore-term") => {
                unsafe {
                    libc::signal(libc::SIGTERM, libc::SIG_IGN);
                }
                if let Ok(path) = std::env::var("TTSFORGE_BACKEND_TEST_FIXTURE_READY") {
                    fs::write(path, b"ready").unwrap();
                }
                thread::sleep(Duration::from_secs(10));
            }
            #[cfg(target_os = "linux")]
            Ok("spawn-parent-death-child") => {
                let ready = std::env::var("TTSFORGE_BACKEND_TEST_CHILD_READY").unwrap();
                let stopped = std::env::var("TTSFORGE_BACKEND_TEST_CHILD_STOPPED").unwrap();
                let pid_path = std::env::var("TTSFORGE_BACKEND_TEST_CHILD_PID").unwrap();
                let mut child = Command::new(std::env::current_exe().unwrap());
                child
                    .args(["--exact", "backend::tests::process_fixture"])
                    .env("TTSFORGE_BACKEND_TEST_FIXTURE", "parent-death-child")
                    .env("TTSFORGE_BACKEND_TEST_CHILD_READY", &ready)
                    .env("TTSFORGE_BACKEND_TEST_CHILD_STOPPED", &stopped)
                    .stdout(Stdio::null())
                    .stderr(Stdio::null());
                configure_process_group(&mut child);
                let child = child.spawn().unwrap();
                fs::write(pid_path, child.id().to_string()).unwrap();
                drop(child);
                for _ in 0..200 {
                    if PathBuf::from(&ready).exists() {
                        return;
                    }
                    thread::sleep(Duration::from_millis(10));
                }
                panic!("parent-death fixture child did not become ready");
            }
            #[cfg(target_os = "linux")]
            Ok("parent-death-child") => {
                unsafe {
                    libc::signal(
                        libc::SIGTERM,
                        mark_parent_died as *const () as libc::sighandler_t,
                    );
                }
                let ready = std::env::var("TTSFORGE_BACKEND_TEST_CHILD_READY").unwrap();
                let stopped = std::env::var("TTSFORGE_BACKEND_TEST_CHILD_STOPPED").unwrap();
                fs::write(ready, b"ready").unwrap();
                while !PARENT_DIED.load(Ordering::Relaxed) {
                    thread::sleep(Duration::from_millis(10));
                }
                fs::write(stopped, b"stopped").unwrap();
            }
            _ => {}
        }
    }

    #[test]
    fn adds_the_explicit_dev_origin_without_wildcards() {
        let args = server_args(
            &PathBuf::from("state"),
            "token",
            Some("http://localhost:1420"),
        );
        assert!(args
            .windows(2)
            .any(|args| args == ["--allow-origin", "http://localhost:1420"]));
        assert_eq!(
            dev_origin_from_host("localhost").unwrap(),
            "http://localhost:1420"
        );
        assert!(dev_origin_from_host("https://example.com").is_err());
    }

    #[test]
    fn extracts_runtime_problem_messages() {
        let problems = runtime_problems(&json!({
            "problems": [{"code": "ffmpeg_missing", "message": "FFmpeg missing"}]
        }));
        assert_eq!(problems, ["FFmpeg missing"]);
    }

    #[test]
    fn rotates_bounded_log_files() {
        let dir = std::env::temp_dir().join(format!("ttsforge-log-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("backend.log");
        let mut log = RotatingLog::open(path.clone()).unwrap();
        log.write_line(&"x".repeat(LOG_LIMIT as usize + 1)).unwrap();
        log.write_line("new entry").unwrap();
        assert!(path.exists());
        assert!(path.with_extension("log.1").exists());
        let protected = Arc::new(Mutex::new(RotatingLog::open(path.clone()).unwrap()));
        log_line(
            &protected,
            "stdout",
            "credential=secret-value",
            "secret-value",
        );
        drop(protected);
        let contents = fs::read_to_string(&path).unwrap();
        assert!(contents.contains("[REDACTED]"));
        assert!(!contents.contains("secret-value"));
        drop(log);
        let _ = fs::remove_dir_all(dir);
    }
}

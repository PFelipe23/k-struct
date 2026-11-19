use crate::engine::{Engine, EngineOrigin};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::Path,
    process::{Child, Command, ExitStatus, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant},
};

const OUTPUT_LIMIT: u64 = 32 * 1024 * 1024;
const LOG_LIMIT: u64 = 16 * 1024;
pub const DECK_LIMIT: usize = 2_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RunStatus {
    Completed,
    Failed,
    Cancelled,
    TimedOut,
}

#[derive(Debug)]
pub struct Execution {
    pub status: RunStatus,
    pub message: String,
    pub output: Option<String>,
    pub stdout: String,
    pub stderr: String,
    pub log_truncated: bool,
}

impl Execution {
    pub fn without_output(status: RunStatus, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
            output: None,
            stdout: String::new(),
            stderr: String::new(),
            log_truncated: false,
        }
    }
}

pub fn validate_deck(deck: &str) -> Result<(), String> {
    let mut header = deck.lines();
    if deck.len() > DECK_LIMIT
        || header.next() != Some("analysis.out")
        || !header
            .next()
            .is_some_and(|line| line.starts_with("KStruct -"))
        || deck.contains('\0')
    {
        return Err("Entrada de análise inválida ou acima de 2 MB.".into());
    }
    Ok(())
}

fn create_child(engine: &Engine, dir: &Path) -> Result<Child, String> {
    let stdout = File::create(dir.join("stdout.log")).map_err(|e| e.to_string())?;
    let stderr = File::create(dir.join("stderr.log")).map_err(|e| e.to_string())?;
    let mut command = Command::new(&engine.path);
    command
        .args(["-f", "analysis.in"])
        .current_dir(dir)
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));
    if engine.info.origin == EngineOrigin::Bundled {
        // The included structural build uses system runtime libraries. AppImage
        // loader settings belong to the desktop executable, not to this engine.
        command
            .env_remove("LD_LIBRARY_PATH")
            .env_remove("LD_PRELOAD");
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    command.spawn().map_err(|e| {
        format!("Não foi possível iniciar OOFEM: {e}. Confira o executável e suas bibliotecas.")
    })
}

fn stop(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn oversized(dir: &Path) -> bool {
    ["analysis.out", "stdout.log", "stderr.log"]
        .iter()
        .any(|name| fs::metadata(dir.join(name)).is_ok_and(|file| file.len() > OUTPUT_LIMIT))
}

enum Stop {
    Exited(ExitStatus),
    Interrupted(RunStatus, String),
}

fn poll_child(mut child: Child, dir: &Path, cancel: &AtomicBool, deadline: Duration) -> Stop {
    let start = Instant::now();
    loop {
        let interrupted = if cancel.load(Ordering::Acquire) {
            Some((RunStatus::Cancelled, "Análise cancelada.".into()))
        } else if start.elapsed() >= deadline {
            Some((
                RunStatus::TimedOut,
                format!("OOFEM excedeu o prazo de {} s.", deadline.as_secs_f64()),
            ))
        } else if oversized(dir) {
            Some((
                RunStatus::Failed,
                "OOFEM excedeu o limite de 32 MB por arquivo.".into(),
            ))
        } else {
            None
        };
        if let Some((status, message)) = interrupted {
            stop(&mut child);
            return Stop::Interrupted(status, message);
        }
        match child.try_wait() {
            Ok(Some(status)) => return Stop::Exited(status),
            Ok(None) => thread::sleep(Duration::from_millis(40)),
            Err(e) => {
                stop(&mut child);
                return Stop::Interrupted(
                    RunStatus::Failed,
                    format!("Falha ao aguardar OOFEM: {e}"),
                );
            }
        }
    }
}

fn log_tail(path: &Path) -> std::io::Result<(String, bool)> {
    let mut file = File::open(path)?;
    let count = file.metadata()?.len();
    let offset = count.saturating_sub(LOG_LIMIT);
    file.seek(SeekFrom::Start(offset))?;
    let mut buf = Vec::new();
    file.take(LOG_LIMIT).read_to_end(&mut buf)?;
    Ok((String::from_utf8_lossy(&buf).into_owned(), offset > 0))
}

fn read_output(dir: &Path) -> Result<String, String> {
    let file = File::open(dir.join("analysis.out"))
        .map_err(|e| format!("OOFEM não gerou a saída esperada: {e}"))?;
    let mut output = String::new();
    file.take(OUTPUT_LIMIT + 1)
        .read_to_string(&mut output)
        .map_err(|e| format!("Falha ao ler a saída OOFEM: {e}"))?;
    if output.len() as u64 > OUTPUT_LIMIT {
        return Err("OOFEM excedeu o limite de 32 MB na saída.".into());
    }
    if !output.contains("Finishing analysis") {
        return Err("OOFEM não confirmou a conclusão do cálculo.".into());
    }
    Ok(output)
}

pub fn run(deck: &str, engine: &Engine, cancel: &AtomicBool, deadline: Duration) -> Execution {
    let execute = || -> Result<Execution, String> {
        validate_deck(deck)?;
        if cancel.load(Ordering::Acquire) {
            return Ok(Execution::without_output(
                RunStatus::Cancelled,
                "Análise cancelada.",
            ));
        }
        let dir = tempfile::Builder::new()
            .prefix("kstruct-")
            .tempdir()
            .map_err(|e| e.to_string())?;
        fs::write(dir.path().join("analysis.in"), deck).map_err(|e| e.to_string())?;
        let child = create_child(engine, dir.path())?;
        let termination = poll_child(child, dir.path(), cancel, deadline);
        let (stdout, stdout_truncated) =
            log_tail(&dir.path().join("stdout.log")).unwrap_or_default();
        let (stderr, stderr_truncated) =
            log_tail(&dir.path().join("stderr.log")).unwrap_or_default();
        let report = match termination {
            Stop::Interrupted(status, message) => Err((status, message)),
            Stop::Exited(status) => {
                let log = format!("{stdout}\n{stderr}").to_ascii_lowercase();
                if !status.success()
                    || ["fatal error", "oofem error", "singular"]
                        .iter()
                        .any(|s| log.contains(s))
                {
                    Err((
                        RunStatus::Failed,
                        format!("OOFEM interrompeu o cálculo ({status})."),
                    ))
                } else {
                    read_output(dir.path()).map_err(|error| (RunStatus::Failed, error))
                }
            }
        };
        let mut result = match report {
            Ok(output) => Execution {
                output: Some(output),
                ..Execution::without_output(RunStatus::Completed, "Execução do OOFEM concluída.")
            },
            Err((status, message)) => Execution::without_output(status, message),
        };
        result.stdout = stdout;
        result.stderr = stderr;
        result.log_truncated = stdout_truncated || stderr_truncated;
        Ok(result)
    };
    execute().unwrap_or_else(|error| Execution::without_output(RunStatus::Failed, error))
}

pub fn version(output: &str) -> Option<String> {
    let version = output.lines().find_map(|line| {
        line.split_once("OOFEM ver. ")?
            .1
            .split_whitespace()
            .next()
            .map(str::to_owned)
    });
    // Some upstream 3.0 builds leave the display version empty but report the Git tag.
    version.or_else(|| {
        output.lines().find_map(|line| {
            let revision = line
                .trim_start()
                .strip_prefix("branch:")?
                .split_once("hash:v")?
                .1;
            let version = revision.split(['-', ' ', '\r']).next()?;
            (!version.is_empty()
                && version
                    .split('.')
                    .all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit())))
            .then(|| version.to_owned())
        })
    })
}

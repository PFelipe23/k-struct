use serde::Serialize;
use std::{fs::{self, File}, io::Read, path::PathBuf, process::{Command, Stdio}, thread, time::{Duration, Instant}};

#[derive(Debug, Serialize)]
pub struct SolverOutput { pub output: String, pub log: String }

fn read_limited(path: &std::path::Path, max: u64) -> Result<String, String> {
    let file = File::open(path).map_err(|e| format!("Saída OOFEM indisponível: {e}"))?;
    if file.metadata().map_err(|e| e.to_string())?.len() > max {
        return Err("Saída excedeu o limite desta versão. Reduza a malha.".into());
    }
    let mut result = String::new();
    file.take(max).read_to_string(&mut result).map_err(|e| e.to_string())?;
    Ok(result)
}

pub fn run(deck: String, executable: Option<String>) -> Result<SolverOutput, String> {
    run_with_timeout(deck, executable, Duration::from_secs(60))
}

fn run_with_timeout(deck: String, executable: Option<String>, timeout: Duration) -> Result<SolverOutput, String> {
    if deck.len() > 2_000_000 || !deck.starts_with("analysis.out\nKStruct -") || deck.contains('\0') {
        return Err("Entrada de análise inválida.".into());
    }
    let executable = executable.filter(|s| !s.trim().is_empty())
        .or_else(|| std::env::var("OOFEM_BIN").ok()).unwrap_or_else(|| "oofem".into());
    let path = PathBuf::from(&executable);
    // A custom path must be absolute, because the child runs in its own temporary directory.
    if path.components().count() > 1 && !path.is_absolute() {
        return Err("Selecione um caminho absoluto para o executável OOFEM.".into());
    }
    let dir = tempfile::Builder::new().prefix("kstruct-").tempdir().map_err(|e| e.to_string())?;
    fs::write(dir.path().join("analysis.in"), deck).map_err(|e| e.to_string())?;
    let stdout = File::create(dir.path().join("stdout.log")).map_err(|e| e.to_string())?;
    let stderr = File::create(dir.path().join("stderr.log")).map_err(|e| e.to_string())?;
    let mut command = Command::new(&executable);
    command.args(["-f", "analysis.in"]).current_dir(dir.path())
        .stdin(Stdio::null()).stdout(Stdio::from(stdout)).stderr(Stdio::from(stderr));
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = command.spawn().map_err(|e| format!("Não foi possível iniciar OOFEM: {e}. Selecione o executável e confira suas bibliotecas."))?;
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {},
            Err(e) => { let _ = child.kill(); let _ = child.wait(); return Err(format!("Falha ao aguardar OOFEM: {e}")); }
        }
        let too_large = ["analysis.out", "stdout.log", "stderr.log"].iter()
            .any(|f| fs::metadata(dir.path().join(f)).map(|m| m.len() > 32*1024*1024).unwrap_or(false));
        if start.elapsed() > timeout || too_large {
            let _ = child.kill(); let _ = child.wait();
            return Err(if too_large { "OOFEM excedeu o limite de saída de 32 MB." } else { "OOFEM excedeu o tempo limite de 60 segundos." }.into());
        }
        thread::sleep(Duration::from_millis(50));
    };
    let stdout = read_limited(&dir.path().join("stdout.log"),32*1024*1024)?;
    let stderr = read_limited(&dir.path().join("stderr.log"),32*1024*1024)?;
    let log = format!("{stdout}\n{stderr}");
    let lower = log.to_lowercase();
    if !status.success() || lower.contains("fatal error") || lower.contains("oofem error") || lower.contains("singular") {
        let tail: String = log.chars().rev().take(3000).collect::<String>().chars().rev().collect();
        return Err(format!("OOFEM interrompeu a análise ({status}).\n{tail}"));
    }
    let output = read_limited(&dir.path().join("analysis.out"),32*1024*1024)?;
    if !output.contains("Finishing analysis") { return Err("OOFEM não confirmou a conclusão da análise.".into()); }
    Ok(SolverOutput { output, log })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_arbitrary_output_paths() {
        assert!(run("/tmp/overwrite\nKStruct -".into(),None).unwrap_err().contains("inválida"));
    }
    #[test]
    fn missing_solver_is_actionable() {
        let error = run("analysis.out\nKStruct - test".into(),Some("kstruct-missing-solver-8c911".into())).err().unwrap();
        assert!(error.contains("iniciar OOFEM"));
    }
    #[cfg(unix)]
    #[test]
    fn timeout_kills_and_reaps_child() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("wait-solver");
        fs::write(&script, "#!/bin/sh\nexec sleep 30\n").unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o700)).unwrap();
        let start = Instant::now();
        assert!(run_with_timeout("analysis.out\nKStruct - test".into(),Some(script.to_string_lossy().into()),Duration::from_millis(100)).is_err());
        assert!(start.elapsed() < Duration::from_secs(2));
    }
}

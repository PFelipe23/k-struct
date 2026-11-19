use crate::{EngineInfo, RunStatus};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::{self, Read, Write},
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

const RETENTION: usize = 30;
const MAX_RECORD_BYTES: u64 = 512 * 1024;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunContext {
    pub run_id: String,
    pub project_name: String,
    pub case_name: String,
}

impl RunContext {
    pub fn validate(&self) -> Result<(), String> {
        if !valid_id(&self.run_id)
            || [&self.project_name, &self.case_name]
                .iter()
                .any(|s| s.is_empty() || s.chars().count() > 120)
        {
            return Err("Identificação da execução inválida.".into());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSummary {
    #[serde(flatten)]
    pub context: RunContext,
    pub started_at: u64,
    pub duration_ms: u64,
    pub status: RunStatus,
    pub message: String,
    pub engine: Option<EngineInfo>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunLog {
    pub summary: RunSummary,
    pub stdout: String,
    pub stderr: String,
    pub log_truncated: bool,
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn valid_id(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

fn sorted_ids(dir: &Path) -> io::Result<Vec<String>> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    let mut records = Vec::new();
    for entry in entries {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let name = entry.file_name();
        if let Some(id) = name
            .to_str()
            .and_then(|s| s.strip_suffix(".json"))
            .filter(|id| valid_id(id))
        {
            let modified = entry.metadata()?.modified().unwrap_or(UNIX_EPOCH);
            records.push((modified, id.to_owned()));
        }
    }
    records.sort_unstable_by(|a, b| b.cmp(a));
    Ok(records.into_iter().map(|(_, id)| id).collect())
}

pub fn write_log(dir: &Path, log: &RunLog) -> Result<(), String> {
    log.summary.context.validate()?;
    let write = || -> io::Result<()> {
        fs::create_dir_all(dir)?;
        let mut temp = tempfile::NamedTempFile::new_in(dir)?;
        serde_json::to_writer(temp.as_file_mut(), log)?;
        temp.flush()?;
        temp.persist_noclobber(dir.join(format!("{}.json", log.summary.context.run_id)))?;
        for old in sorted_ids(dir)?.into_iter().skip(RETENTION) {
            fs::remove_file(dir.join(format!("{old}.json")))?;
        }
        Ok(())
    };
    write().map_err(|e| format!("Não foi possível guardar o registro da execução: {e}"))
}

pub fn read_log(dir: &Path, id: &str) -> Result<RunLog, String> {
    if !valid_id(id) {
        return Err("Identificador de execução inválido.".into());
    }
    let read = || -> io::Result<RunLog> {
        let path = dir.join(format!("{id}.json"));
        let metadata = fs::symlink_metadata(&path)?;
        if !metadata.is_file() || metadata.len() > MAX_RECORD_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "registro inválido",
            ));
        }
        let log: RunLog = serde_json::from_reader(File::open(path)?.take(MAX_RECORD_BYTES))?;
        if log.summary.context.run_id != id {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "identificador divergente",
            ));
        }
        Ok(log)
    };
    read().map_err(|e| format!("Não foi possível ler o registro da execução: {e}"))
}

pub fn list_logs(dir: &Path) -> Result<Vec<RunSummary>, String> {
    let ids =
        sorted_ids(dir).map_err(|e| format!("Não foi possível abrir o histórico do OOFEM: {e}"))?;
    let mut entries: Vec<_> = ids
        .iter()
        .filter_map(|id| read_log(dir, id).ok().map(|log| log.summary))
        .take(RETENTION)
        .collect();
    entries.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    Ok(entries)
}

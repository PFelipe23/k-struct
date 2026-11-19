mod engine;
mod history;
mod process;

pub use engine::{resolve_engine, Engine, EngineInfo, EngineOrigin};
pub use history::{
    list_logs, now_ms, read_log, valid_id, write_log, RunContext, RunLog, RunSummary,
};
pub use process::{run, validate_deck, version, Execution, RunStatus};

use serde::Serialize;
use std::{path::Path, sync::atomic::AtomicBool, time::Duration};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub ok: bool,
    pub message: String,
    pub engine: Option<EngineInfo>,
    pub benchmark: Option<BeamCheck>,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BeamCheck {
    pub left_reaction_n: f64,
    pub right_reaction_n: f64,
    pub midspan_uz_m: f64,
}

fn check_beam(output: &str) -> Option<BeamCheck> {
    let mut node_number = "";
    let (mut left, mut right, mut middle) = (None, None, None);
    for line in output.lines() {
        let parts: Vec<_> = line.split_whitespace().collect();
        match parts.as_slice() {
            ["Node", "1", "iDof", "3", "reaction", value, ..] => left = value.parse::<f64>().ok(),
            ["Node", "2", "iDof", "3", "reaction", value, ..] => right = value.parse::<f64>().ok(),
            ["Node", number, "(", ..] => node_number = number,
            ["dof", "3", "d", value] if node_number == "6" => middle = value.parse::<f64>().ok(),
            _ => {}
        }
    }
    let check = BeamCheck {
        left_reaction_n: left?,
        right_reaction_n: right?,
        midspan_uz_m: middle?,
    };
    ((check.left_reaction_n - 30_000.0).abs() < 0.1
        && (check.right_reaction_n - 30_000.0).abs() < 0.1
        && (check.midspan_uz_m + 0.0084375).abs() < 1e-8)
        .then_some(check)
}

pub fn diagnose(resource_dir: &Path, custom: Option<&str>, require_bundle: bool) -> Diagnostic {
    let mut engine = match resolve_engine(resource_dir, custom, require_bundle) {
        Ok(engine) => engine,
        Err(message) => {
            return Diagnostic {
                ok: false,
                message,
                engine: None,
                benchmark: None,
                stdout: String::new(),
                stderr: String::new(),
            }
        }
    };
    let execution = run(
        include_str!("../../../tests/fixtures/beam.in"),
        &engine,
        &AtomicBool::new(false),
        Duration::from_secs(10),
    );
    let reported_version = execution.output.as_deref().and_then(version);
    let expected_version = &engine.info.version;
    let version_ok = match expected_version {
        Some(expected) => reported_version
            .as_ref()
            .is_some_and(|actual| actual == expected),
        None => reported_version.is_some(),
    };
    let benchmark = execution.output.as_deref().and_then(check_beam);
    let ok = execution.status == RunStatus::Completed && version_ok && benchmark.is_some();
    let message = if ok {
        "Motor disponível. A viga de referência reproduziu as reações e a flecha esperadas.".into()
    } else if execution.status != RunStatus::Completed {
        execution.message
    } else {
        "O motor não reproduziu os resultados ou a versão esperados na viga de referência.".into()
    };
    if reported_version.is_some() {
        engine.info.version = reported_version;
    }
    Diagnostic {
        ok,
        message,
        engine: Some(engine.info),
        benchmark,
        stdout: execution.stdout,
        stderr: execution.stderr,
    }
}

#[cfg(test)]
mod tests;

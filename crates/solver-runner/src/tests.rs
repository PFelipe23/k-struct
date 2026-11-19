use super::*;
use std::{fs, sync::atomic::Ordering, thread, time::Instant};

const BEAM: &str = include_str!("../../../tests/fixtures/beam.in");
const ID: &str = "a1b2c3d4-1234-4567-8abc-00000000000f";

#[test]
#[ignore = "requires OOFEM_BIN pointing to a real OOFEM executable"]
fn diagnoses_real_reference_model() {
    let executable = std::env::var("OOFEM_BIN").expect("OOFEM_BIN must be set");
    let dir = tempfile::tempdir().unwrap();
    let result = diagnose(dir.path(), Some(&executable), false);
    assert!(result.ok, "{result:?}");
    assert_eq!(result.engine.unwrap().origin, EngineOrigin::Custom);
    assert!((result.benchmark.unwrap().midspan_uz_m + 0.0084375).abs() < 1e-8);
}

#[test]
fn rejects_invalid_path_and_incomplete_bundle() {
    let dir = tempfile::tempdir().unwrap();
    assert!(validate_deck("/tmp/overwrite\nKStruct -").is_err());
    assert!(resolve_engine(dir.path(), Some("relative/oofem"), false)
        .unwrap_err()
        .contains("absoluto"));
    assert!(resolve_engine(dir.path(), None, true)
        .unwrap_err()
        .contains("manifesto"));
}

#[test]
fn cancelled_before_start_has_no_output() {
    let result = run(
        BEAM,
        &Engine {
            path: "not-an-executable".into(),
            info: EngineInfo {
                origin: EngineOrigin::Custom,
                path: String::new(),
                version: None,
                commit: None,
                sha256: None,
            },
        },
        &AtomicBool::new(true),
        Duration::from_secs(1),
    );
    assert_eq!(result.status, RunStatus::Cancelled);
    assert!(result.output.is_none());
}

#[cfg(unix)]
#[test]
fn cancellation_and_timeout_stop_running_process_and_keep_its_log() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let executable = dir.path().join("wait-solver");
    fs::write(
        &executable,
        "#!/bin/sh\necho 'started solver'\nexec sleep 30\n",
    )
    .unwrap();
    fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
    let engine = resolve_engine(dir.path(), executable.to_str(), false).unwrap();
    let active = AtomicBool::new(false);
    let start = Instant::now();
    thread::scope(|scope| {
        scope.spawn(|| {
            thread::sleep(Duration::from_millis(250));
            active.store(true, Ordering::Release);
        });
        let result = run(BEAM, &engine, &active, Duration::from_secs(30));
        assert_eq!(result.status, RunStatus::Cancelled);
        assert!(result.stdout.contains("started solver"));
        assert!(result.output.is_none());
    });
    let result = run(
        BEAM,
        &engine,
        &AtomicBool::new(false),
        Duration::from_millis(100),
    );
    assert_eq!(result.status, RunStatus::TimedOut);
    assert!(start.elapsed() < Duration::from_secs(3));
}

#[test]
fn records_are_atomic_roundtrip_and_bounded() {
    let dir = tempfile::tempdir().unwrap();
    assert!(read_log(dir.path(), "../unsafe").is_err());
    assert!(list_logs(dir.path()).unwrap().is_empty());
    let mut log = RunLog {
        summary: RunSummary {
            context: RunContext {
                run_id: ID.into(),
                project_name: "Viga".into(),
                case_name: "EL".into(),
            },
            started_at: now_ms(),
            duration_ms: 12,
            status: RunStatus::Cancelled,
            message: "Análise cancelada.".into(),
            engine: None,
        },
        stdout: "início".into(),
        stderr: String::new(),
        log_truncated: false,
    };
    write_log(dir.path(), &log).unwrap();
    assert!(write_log(dir.path(), &log).is_err());
    assert_eq!(read_log(dir.path(), ID).unwrap().stdout, "início");
    for n in 0..31 {
        log.summary.context.run_id = format!("44334433-1122-1234-789a-{n:012x}");
        log.summary.started_at += 1;
        write_log(dir.path(), &log).unwrap();
    }
    assert_eq!(list_logs(dir.path()).unwrap().len(), 30);
    assert!(fs::read_dir(dir.path()).unwrap().count() <= 30);
}

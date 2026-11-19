use kstruct_solver_runner::{
    self as solver, Diagnostic, Execution, RunContext, RunLog, RunStatus, RunSummary,
};
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{ipc::Channel, AppHandle, ExitRequestApi, Manager, State};

#[derive(Default)]
struct Slot {
    active: Mutex<Option<(String, Arc<AtomicBool>)>>,
    released: Condvar,
    exiting: AtomicBool,
}

#[derive(Clone, Default)]
pub struct AnalysisState(Arc<Slot>);

struct Lease {
    state: AnalysisState,
    cancel: Arc<AtomicBool>,
}

impl Drop for Lease {
    fn drop(&mut self) {
        if let Ok(mut active) = self.state.0.active.lock() {
            *active = None;
            self.state.0.released.notify_all();
        }
    }
}

impl AnalysisState {
    fn reserve(&self, id: &str) -> Result<Lease, String> {
        let mut active = self.0.active.lock().map_err(|e| e.to_string())?;
        if active.is_some() || self.0.exiting.load(Ordering::Acquire) {
            return Err("Aguarde o término da execução do OOFEM.".into());
        }
        let cancel = Arc::new(AtomicBool::new(false));
        *active = Some((id.into(), cancel.clone()));
        Ok(Lease {
            state: self.clone(),
            cancel,
        })
    }

    pub fn on_exit(&self, app: &AppHandle, api: ExitRequestApi) {
        let Ok(active) = self.0.active.lock() else {
            return;
        };
        let Some((_, cancel)) = &*active else {
            return;
        };
        cancel.store(true, Ordering::Release);
        api.prevent_exit();
        if self.0.exiting.swap(true, Ordering::AcqRel) {
            return;
        }
        let state = self.clone();
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            if let Ok(active) = state.0.active.lock() {
                drop(state.0.released.wait_while(active, |job| job.is_some()));
            }
            app.exit(0);
        });
    }
}

#[derive(Clone)]
pub struct EngineLocation {
    pub resource_dir: PathBuf,
    pub require_bundle: bool,
}

impl EngineLocation {
    fn from_app(app: &AppHandle) -> Result<Self, String> {
        Ok(Self {
            resource_dir: app.path().resource_dir().map_err(|e| e.to_string())?,
            require_bundle: tauri::utils::platform::bundle_type().is_some(),
        })
    }

    pub fn diagnose(&self, executable: Option<&str>) -> Diagnostic {
        solver::diagnose(&self.resource_dir, executable, self.require_bundle)
    }
}

fn history_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|dir| dir.join("oofem-history-v1"))
        .map_err(|e| format!("Não foi possível localizar o histórico: {e}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResponse {
    log: RunLog,
    output: Option<String>,
    history_error: Option<String>,
}

#[tauri::command]
pub fn start_oofem(
    app: AppHandle,
    state: State<'_, AnalysisState>,
    deck: String,
    executable: Option<String>,
    run_context: RunContext,
    response: Channel<RunResponse>,
) -> Result<(), String> {
    run_context.validate()?;
    solver::validate_deck(&deck)?;
    let location = EngineLocation::from_app(&app)?;
    let history = history_dir(&app);
    let lease = state.reserve(&run_context.run_id)?;
    let started_at = solver::now_ms();
    let start = Instant::now();

    tauri::async_runtime::spawn_blocking(move || {
        let (engine, execution) = match solver::resolve_engine(
            &location.resource_dir,
            executable.as_deref(),
            location.require_bundle,
        ) {
            Ok(engine) => {
                let execution = solver::run(&deck, &engine, &lease.cancel, Duration::from_secs(60));
                let mut info = engine.info;
                if let Some(version) = execution
                    .output
                    .as_deref()
                    .and_then(solver::version)
                    .or_else(|| solver::version(&execution.stdout))
                {
                    info.version = Some(version);
                }
                (Some(info), execution)
            }
            Err(message) => (None, Execution::without_output(RunStatus::Failed, message)),
        };
        let log = RunLog {
            summary: RunSummary {
                context: run_context,
                started_at,
                duration_ms: start.elapsed().as_millis() as u64,
                status: execution.status,
                message: execution.message,
                engine,
            },
            stdout: execution.stdout,
            stderr: execution.stderr,
            log_truncated: execution.log_truncated,
        };
        let history_error = history.and_then(|dir| solver::write_log(&dir, &log)).err();
        drop(lease);
        let _ = response.send(RunResponse {
            log,
            output: execution.output,
            history_error,
        });
    });
    Ok(())
}

#[tauri::command]
pub fn cancel_oofem(state: State<'_, AnalysisState>, run_id: String) -> Result<bool, String> {
    let active = state.0.active.lock().map_err(|e| e.to_string())?;
    if let Some((_, cancel)) = active.as_ref().filter(|(id, _)| id == &run_id) {
        cancel.store(true, Ordering::Release);
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub async fn diagnose_oofem(
    app: AppHandle,
    executable: Option<String>,
) -> Result<Diagnostic, String> {
    let location = EngineLocation::from_app(&app)?;
    tauri::async_runtime::spawn_blocking(move || location.diagnose(executable.as_deref()))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_oofem_runs(app: AppHandle) -> Result<Vec<RunSummary>, String> {
    let dir = history_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || solver::list_logs(&dir))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn read_oofem_log(app: AppHandle, run_id: String) -> Result<RunLog, String> {
    let dir = history_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || solver::read_log(&dir, &run_id))
        .await
        .map_err(|e| e.to_string())?
}

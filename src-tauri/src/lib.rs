mod analysis;

use analysis::{AnalysisState, EngineLocation};
use std::{ffi::OsStr, fs::File, path::Path};
use tauri::{Manager, RunEvent};

fn check_oofem(
    report_path: &Path,
    package: &tauri::PackageInfo,
) -> Result<bool, Box<dyn std::error::Error>> {
    let location = EngineLocation {
        resource_dir: tauri::utils::platform::resource_dir(package, &tauri::Env::default())?,
        require_bundle: tauri::utils::platform::bundle_type().is_some(),
    };
    let report = location.diagnose(None);
    serde_json::to_writer_pretty(File::create(report_path)?, &report)?;
    Ok(report.ok)
}

pub fn run() {
    let context = tauri::generate_context!();
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() == Some(OsStr::new("--check-oofem")) {
        let code = match args.next() {
            Some(path) => match check_oofem(Path::new(&path), context.package_info()) {
                Ok(true) => 0,
                Ok(false) => 1,
                Err(e) => {
                    eprintln!("Falha no diagnóstico do OOFEM: {e}");
                    2
                }
            },
            None => {
                eprintln!("Uso: k-struct --check-oofem <relatorio.json>");
                2
            }
        };
        std::process::exit(code);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AnalysisState::default())
        .invoke_handler(tauri::generate_handler![
            analysis::start_oofem,
            analysis::cancel_oofem,
            analysis::diagnose_oofem,
            analysis::list_oofem_runs,
            analysis::read_oofem_log,
        ])
        .build(context)
        .expect("Erro ao iniciar KStruct")
        .run(|app, event| {
            if let RunEvent::ExitRequested { api, .. } = event {
                app.state::<AnalysisState>().on_exit(app, api);
            }
        });
}

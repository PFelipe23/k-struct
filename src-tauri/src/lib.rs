#[tauri::command]
async fn run_oofem(deck: String, executable: Option<String>) -> Result<kstruct_solver_runner::SolverOutput, String> {
    tauri::async_runtime::spawn_blocking(move || kstruct_solver_runner::run(deck, executable))
        .await.map_err(|e| e.to_string())?
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![run_oofem])
        .run(tauri::generate_context!())
        .expect("Erro ao iniciar KStruct");
}

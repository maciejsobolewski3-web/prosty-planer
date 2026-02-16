// Prosty Planer — Tauri backend
// MVP: localStorage na frontendzie, SQLite dojdzie później

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("Błąd podczas uruchamiania aplikacji");
}

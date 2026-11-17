use std::path::Path;
mod codex_bridge;

fn write_bytes(path: &Path, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(path, data)
        .map_err(|error| format!("Could not write {}: {error}", path.display()))
}

#[tauri::command]
fn write_export_file(path: String, data: Vec<u8>) -> Result<(), String> {
    let target = Path::new(&path);
    if target.file_name().is_none() {
        return Err("Choose a valid export file path.".into());
    }
    write_bytes(target, data)
}

#[tauri::command]
fn write_export_file_in_directory(
    directory: String,
    name: String,
    data: Vec<u8>,
) -> Result<(), String> {
    let name_path = Path::new(&name);
    if name_path.components().count() != 1 || name_path.file_name().is_none() {
        return Err("The export filename is invalid.".into());
    }
    write_bytes(&Path::new(&directory).join(name_path), data)
}

#[tauri::command]
fn read_project_file(path: String) -> Result<String, String> {
    let target = Path::new(&path);
    if !target.is_file() {
        return Err("Choose a valid project file.".into());
    }
    std::fs::read_to_string(target)
        .map_err(|error| format!("Could not read {}: {error}", target.display()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(codex_bridge::CodexBridge::default())
        .invoke_handler(tauri::generate_handler![
            write_export_file,
            write_export_file_in_directory,
            read_project_file,
            codex_bridge::codex_connection_status,
            codex_bridge::codex_chat,
            codex_bridge::codex_cancel
        ])
        .run(tauri::generate_context!())
        .expect("error while running Pixel Rig Studio");
}

use std::path::Path;

fn write_bytes(path: &Path, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(path, data).map_err(|error| format!("Could not write {}: {error}", path.display()))
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
fn write_export_file_in_directory(directory: String, name: String, data: Vec<u8>) -> Result<(), String> {
    let name_path = Path::new(&name);
    if name_path.components().count() != 1 || name_path.file_name().is_none() {
        return Err("The export filename is invalid.".into());
    }
    write_bytes(&Path::new(&directory).join(name_path), data)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![write_export_file, write_export_file_in_directory])
        .run(tauri::generate_context!())
        .expect("error while running Pixel Rig Studio");
}

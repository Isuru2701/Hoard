use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};

#[derive(Serialize)]
struct Entry {
    name: String,
    kind: &'static str,
    size: Option<u64>,
    modified: Option<u64>,
}

#[derive(Serialize)]
struct FileData {
    name: String,
    data: String,
    size: usize,
    modified: u64,
}

fn safe_path(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("Parent directory segments are not allowed".into());
    }
    if !path.is_absolute() {
        return Err("An absolute path is required".into());
    }
    Ok(path)
}

fn modified(path: &Path) -> Option<u64> {
    fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|value| value.as_millis() as u64)
}

#[tauri::command]
async fn choose_folder() -> Option<String> {
    rfd::AsyncFileDialog::new()
        .set_title("Choose a Hoard workspace")
        .pick_folder()
        .await
        .map(|handle| handle.path().to_string_lossy().into_owned())
}

#[tauri::command]
fn list_directory(path: String) -> Result<Vec<Entry>, String> {
    let path = safe_path(&path)?;
    let mut result = Vec::new();
    for item in fs::read_dir(path).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let metadata = item.metadata().map_err(|e| e.to_string())?;
        result.push(Entry {
            name: item.file_name().to_string_lossy().into_owned(),
            kind: if metadata.is_dir() {
                "directory"
            } else {
                "file"
            },
            size: metadata.is_file().then_some(metadata.len()),
            modified: modified(&item.path()),
        });
    }
    Ok(result)
}

#[tauri::command]
fn read_file(path: String) -> Result<FileData, String> {
    let path = safe_path(&path)?;
    let data = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(FileData {
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        size: data.len(),
        data: STANDARD.encode(data),
        modified: modified(&path).unwrap_or_default(),
    })
}

#[tauri::command]
fn write_file(path: String, data: String) -> Result<(), String> {
    let path = safe_path(&path)?;
    let data = STANDARD.decode(data).map_err(|e| e.to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, data).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_file(path: String) -> Result<(), String> {
    let path = safe_path(&path)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if !path.exists() {
        fs::write(path, []).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn create_directory(path: String) -> Result<(), String> {
    fs::create_dir_all(safe_path(&path)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn entry_kind(path: String) -> Result<Option<&'static str>, String> {
    let path = safe_path(&path)?;
    match fs::metadata(path) {
        Ok(metadata) => Ok(Some(if metadata.is_dir() {
            "directory"
        } else {
            "file"
        })),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn remove_entry(path: String, recursive: bool) -> Result<(), String> {
    let path = safe_path(&path)?;
    let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
    if metadata.is_dir() && recursive {
        fs::remove_dir_all(path).map_err(|e| e.to_string())
    } else if metadata.is_dir() {
        fs::remove_dir(path).map_err(|e| e.to_string())
    } else {
        fs::remove_file(path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    let path = safe_path(&path)?;
    std::process::Command::new("explorer")
        .arg("/select,")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            choose_folder,
            list_directory,
            read_file,
            write_file,
            create_file,
            create_directory,
            entry_kind,
            remove_entry,
            reveal_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running Hoard");
}

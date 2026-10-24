use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::Manager;

const OVERLAY_LABEL: &str = "overlay";

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

/// Fast native rename/move (same volume). Callers fall back to copy+delete on error.
#[tauri::command]
fn move_path(from: String, to: String) -> Result<(), String> {
    let from = safe_path(&from)?;
    let to = safe_path(&to)?;
    if from == to {
        return Ok(());
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&from, &to).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------- overlay mode

/// A click-through overlay window that floats the canvas images over other apps.
/// Empty parts of the window are transparent AND click-through (window region),
/// so the app underneath keeps working. Returns true when a new window was created.
#[tauri::command]
async fn overlay_open(app: tauri::AppHandle) -> Result<bool, String> {
    if let Some(existing) = app.get_webview_window(OVERLAY_LABEL) {
        let _ = existing.show();
        return Ok(false);
    }
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is missing".to_string())?;
    // Land on whichever monitor the main window is currently on.
    let monitor = main
        .current_monitor()
        .map_err(|e| e.to_string())?
        .or_else(|| app.primary_monitor().ok().flatten());
    let mut builder = tauri::WebviewWindowBuilder::new(
        &app,
        OVERLAY_LABEL,
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Hoard overlay")
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .shadow(false)
    .resizable(false)
    .focused(false)
    .initialization_script("window.__HOARD_OVERLAY__ = true;");
    if let Some(m) = &monitor {
        let p = m.position();
        builder = builder.position(p.x as f64, p.y as f64);
    }
    let window = builder.build().map_err(|e| e.to_string())?;
    // Borderless fullscreen pinned to that same monitor.
    if let Some(m) = window.current_monitor().map_err(|e| e.to_string())?.or(monitor) {
        let p = m.position();
        let _ = window.set_fullscreen_on_monitor(tauri::PhysicalPosition::new(p.x as f64, p.y as f64));
    }
    Ok(true)
}

#[tauri::command]
fn overlay_close(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Lock: clicks pass through the overlay (images included) to the app below.
#[tauri::command]
fn overlay_set_locked(window: tauri::WebviewWindow, locked: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        unsafe { set_ws_ex_transparent(hwnd, locked) };
    }
    #[cfg(not(windows))]
    {
        window
            .set_ignore_cursor_events(locked)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Escape hatch: release input back to the overlay after lock and focus it.
#[tauri::command]
fn overlay_release(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        #[cfg(windows)]
        {
            let hwnd = window.hwnd().map_err(|e| e.to_string())?;
            unsafe { set_ws_ex_transparent(hwnd, false) };
        }
        #[cfg(not(windows))]
        {
            window
                .set_ignore_cursor_events(false)
                .map_err(|e| e.to_string())?;
        }
        let _ = window.set_focus();
    }
    Ok(())
}

#[derive(Deserialize)]
struct OverlayRect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

/// Limits hit-testing to the given logical rects (images + controls); clicks on
/// anything outside the region fall through to the app underneath (Windows).
#[tauri::command]
fn overlay_set_regions(window: tauri::WebviewWindow, rects: Vec<OverlayRect>) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::Win32::Graphics::Gdi::{CombineRgn, CreateRectRgn, RGN_OR, SetWindowRgn};
        let scale = window.scale_factor().map_err(|e| e.to_string())?;
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        let mut region = None;
        for r in &rects {
            let x = (r.x * scale).round() as i32;
            let y = (r.y * scale).round() as i32;
            let w = (r.w * scale).round() as i32;
            let h = (r.h * scale).round() as i32;
            if w <= 0 || h <= 0 {
                continue;
            }
            let piece = CreateRectRgn(x, y, x + w, y + h);
            match region.replace(piece) {
                Some(prev) => {
                    unsafe {
                        CombineRgn(Some(piece), Some(piece), Some(prev), RGN_OR);
                    }
                }
                None => region = Some(piece),
            }
        }
        unsafe {
            SetWindowRgn(hwnd, region, true);
        }
    }
    #[cfg(not(windows))]
    let _ = rects;
    Ok(())
}

#[cfg(windows)]
unsafe fn set_ws_ex_transparent(hwnd: windows::Win32::Foundation::HWND, transparent: bool) {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_TRANSPARENT,
    };
    let mut ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
    if transparent {
        ex |= WS_EX_TRANSPARENT.0 as isize;
    } else {
        ex &= !(WS_EX_TRANSPARENT.0 as isize);
    }
    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex);
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
            reveal_path,
            move_path,
            overlay_open,
            overlay_close,
            overlay_set_locked,
            overlay_release,
            overlay_set_regions
        ])
        .run(tauri::generate_context!())
        .expect("error while running Hoard");
}

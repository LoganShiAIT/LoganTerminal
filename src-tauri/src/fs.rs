use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
pub struct FsEntry {
    pub name: String,
    pub is_dir: bool,
}

#[tauri::command]
pub fn fs_list_dir(path: String) -> Result<Vec<FsEntry>, String> {
    let path = Path::new(&path);
    let read = std::fs::read_dir(path).map_err(|e| e.to_string())?;

    let mut entries: Vec<FsEntry> = read
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                return None;
            }
            let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            Some(FsEntry { name, is_dir })
        })
        .collect();

    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.cmp(&b.name)));
    Ok(entries)
}

#[tauri::command]
pub fn fs_home_dir() -> String {
    #[cfg(unix)]
    {
        std::env::var("HOME").unwrap_or_default()
    }
    #[cfg(windows)]
    {
        std::env::var("USERPROFILE").unwrap_or_default()
    }
}

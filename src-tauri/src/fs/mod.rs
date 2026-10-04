//! Filesystem access exposed to the frontend.
//!
//! - [`files`]  — list, stat, read and write plain files.
//! - [`search`] — the bounded fuzzy walk behind the file finder.
//! - [`paste`]  — clipboard text spilled to a file under `~/.logan-terminal`.
//!
//! Every `#[tauri::command]` lives here (the macro's generated helpers do not
//! survive a re-export), so the submodules stay plain Rust — directly
//! callable and testable without a Tauri app.

mod files;
mod paste;
mod search;

use files::{FsEntry, FsPathInfo};
use search::{SearchKind, SearchOpts, SearchOutcome};
use std::path::{Path, PathBuf};

#[tauri::command]
pub fn fs_list_dir(path: String, show_hidden: Option<bool>) -> Result<Vec<FsEntry>, String> {
    files::list_dir_entries(Path::new(&path), show_hidden.unwrap_or(false))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_search(
    root: String,
    query: String,
    kind: Option<String>,
    show_hidden: Option<bool>,
    limit: Option<usize>,
) -> Result<SearchOutcome, String> {
    let opts = SearchOpts::new(
        SearchKind::parse(kind.as_deref()),
        show_hidden.unwrap_or(false),
        limit.unwrap_or(search::SEARCH_DEFAULT_LIMIT),
    );
    search::search_dir(Path::new(&root), &query, &opts).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_stat_path(path: String) -> Result<FsPathInfo, String> {
    files::stat_path(Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fs_read_text_file(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        files::read_text_file(Path::new(&path)).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fs_canonical_path(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::canonicalize(path)
            .map(|p| p.to_string_lossy().into_owned())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fs_resolve_image(target: String, base_dir: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || files::resolve_image(&target, base_dir.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn fs_write_text_file(path: String, contents: String) -> Result<(), String> {
    files::write_text_file(Path::new(&path), &contents).map_err(|e| e.to_string())
}

/// Writes clipboard text to `~/.logan-terminal/pastes/paste-<stamp>.txt` and
/// returns the path. The frontend supplies the (cosmetic, time-sortable)
/// stamp; uniqueness comes from the collision suffix, and the directory is
/// pruned to the newest [`paste::MAX_PASTE_FILES`].
#[tauri::command]
pub fn paste_to_file(contents: String, stamp: String) -> Result<String, String> {
    let dir = pastes_dir().ok_or("no home directory")?;
    paste::paste_into_dir(
        &dir,
        &contents,
        &paste::sanitize_stamp(&stamp),
        paste::MAX_PASTE_FILES,
    )
    .map(|p| p.to_string_lossy().into_owned())
    .map_err(|e| e.to_string())
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

fn pastes_dir() -> Option<PathBuf> {
    let home = fs_home_dir();
    if home.is_empty() {
        return None;
    }
    Some(PathBuf::from(home).join(".logan-terminal").join("pastes"))
}

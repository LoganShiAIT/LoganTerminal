mod agents;
mod clipboard;
mod fs;
mod pty;
mod screenshots;

use agents::AgentState;
use clipboard::ClipboardHistory;
use pty::PtyManager;
use screenshots::ScreenshotHistory;
use tauri::{AppHandle, State};

#[tauri::command]
fn pty_spawn(
    app: AppHandle,
    state: State<'_, PtyManager>,
    session_id: Option<String>,
    rows: u16,
    cols: u16,
    shell: Option<String>,
    cwd: Option<String>,
) -> Result<String, String> {
    state
        .spawn(app, session_id, rows, cols, shell, cwd)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_write(state: State<'_, PtyManager>, session_id: String, data: String) -> Result<(), String> {
    state.write(&session_id, &data).map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_resize(
    state: State<'_, PtyManager>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    state
        .resize(&session_id, rows, cols)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_kill(state: State<'_, PtyManager>, session_id: String) -> Result<(), String> {
    state.kill(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn shell_escape_paths(paths: Vec<String>) -> Vec<String> {
    paths.into_iter().map(shell_escape_path).collect()
}

#[cfg(windows)]
fn shell_escape_path(path: String) -> String {
    powershell_escape_path(&path)
}

#[cfg(not(windows))]
fn shell_escape_path(path: String) -> String {
    posix_escape_path(&path)
}

#[cfg(any(windows, test))]
fn powershell_escape_path(path: &str) -> String {
    format!("'{}'", path.replace('\'', "''"))
}

#[cfg(any(not(windows), test))]
fn posix_escape_path(path: &str) -> String {
    shell_escape::escape(path.into()).into_owned()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(PtyManager::new())
        .manage(ClipboardHistory::new())
        .manage(ScreenshotHistory::new())
        .manage(AgentState::new())
        .setup(|app| {
            clipboard::spawn_monitor(app.handle().clone());
            screenshots::seed_recent(app.handle());
            screenshots::spawn_watcher(app.handle().clone());
            agents::spawn_monitor(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            shell_escape_paths,
            fs::fs_list_dir,
            fs::fs_stat_path,
            fs::fs_read_text_file,
            fs::fs_write_text_file,
            fs::fs_home_dir,
            clipboard::clipboard_history,
            clipboard::clipboard_remove,
            screenshots::screenshot_history,
            screenshots::screenshot_remove,
            agents::agent_snapshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn posix_escape_quotes_spaces_and_apostrophes() {
        let with_space = posix_escape_path("/tmp/a b");
        assert_ne!(with_space, "/tmp/a b");
        assert!(with_space.contains("a b"));

        #[cfg(not(windows))]
        {
            let with_apostrophe = posix_escape_path("/tmp/O'Brien");
            assert_ne!(with_apostrophe, "/tmp/O'Brien");
            assert!(with_apostrophe.contains("O"));
            assert!(with_apostrophe.contains("Brien"));
        }
    }

    #[test]
    fn powershell_escape_quotes_spaces_and_apostrophes() {
        assert_eq!(
            powershell_escape_path(r"C:\Users\Logan\a b.png"),
            r"'C:\Users\Logan\a b.png'"
        );
        assert_eq!(
            powershell_escape_path(r"C:\O'Brien.png"),
            r"'C:\O''Brien.png'"
        );
    }
}

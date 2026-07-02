use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
pub struct FsEntry {
    pub name: String,
    pub is_dir: bool,
}

fn list_dir_entries(path: &Path, show_hidden: bool) -> std::io::Result<Vec<FsEntry>> {
    let read = std::fs::read_dir(path)?;

    let mut entries: Vec<FsEntry> = read
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if !show_hidden && name.starts_with('.') {
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
pub fn fs_list_dir(path: String, show_hidden: Option<bool>) -> Result<Vec<FsEntry>, String> {
    list_dir_entries(Path::new(&path), show_hidden.unwrap_or(false)).map_err(|e| e.to_string())
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn make_fixture_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("logan-fs-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("b.txt"), "b").unwrap();
        fs::write(dir.join("a.txt"), "a").unwrap();
        fs::write(dir.join(".env"), "secret").unwrap();
        fs::create_dir(dir.join(".claude")).unwrap();
        dir
    }

    #[test]
    fn hidden_entries_are_filtered_by_default() {
        let dir = make_fixture_dir();
        let names: Vec<String> = list_dir_entries(&dir, false)
            .unwrap()
            .into_iter()
            .map(|e| e.name)
            .collect();
        assert_eq!(names, vec!["sub", "a.txt", "b.txt"]);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn show_hidden_includes_dotfiles_dirs_first_sorted() {
        let dir = make_fixture_dir();
        let entries = list_dir_entries(&dir, true).unwrap();
        let names: Vec<String> = entries.iter().map(|e| e.name.clone()).collect();
        assert_eq!(names, vec![".claude", "sub", ".env", "a.txt", "b.txt"]);
        assert!(entries[0].is_dir && entries[1].is_dir);
        assert!(!entries[2].is_dir);
        fs::remove_dir_all(dir).unwrap();
    }
}

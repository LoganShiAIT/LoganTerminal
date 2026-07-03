use serde::Serialize;
use std::path::Path;

const MAX_TEXT_FILE_BYTES: u64 = 1024 * 1024;

#[derive(Serialize)]
pub struct FsEntry {
    pub name: String,
    pub is_dir: bool,
}

#[derive(Serialize)]
pub struct FsPathInfo {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub size: u64,
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
pub fn fs_stat_path(path: String) -> Result<FsPathInfo, String> {
    stat_path(Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_read_text_file(path: String) -> Result<String, String> {
    read_text_file(Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_write_text_file(path: String, contents: String) -> Result<(), String> {
    write_text_file(Path::new(&path), &contents).map_err(|e| e.to_string())
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

fn stat_path(path: &Path) -> std::io::Result<FsPathInfo> {
    let metadata = std::fs::metadata(path)?;
    let kind = if metadata.is_dir() {
        "directory"
    } else if metadata.is_file() {
        "file"
    } else {
        "other"
    };
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_else(|| path.to_str().unwrap_or(""))
        .to_string();

    Ok(FsPathInfo {
        path: path.to_string_lossy().into_owned(),
        name,
        kind: kind.to_string(),
        size: metadata.len(),
    })
}

fn read_text_file(path: &Path) -> std::io::Result<String> {
    let metadata = std::fs::metadata(path)?;
    if !metadata.is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "path is not a file",
        ));
    }
    if metadata.len() > MAX_TEXT_FILE_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "file is larger than 1MB",
        ));
    }

    let bytes = std::fs::read(path)?;
    if bytes.contains(&0) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "file appears to be binary",
        ));
    }
    String::from_utf8(bytes).map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "file is not valid UTF-8 text",
        )
    })
}

fn write_text_file(path: &Path, contents: &str) -> std::io::Result<()> {
    let metadata = std::fs::metadata(path)?;
    if !metadata.is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "path is not a file",
        ));
    }
    std::fs::write(path, contents)
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

    #[test]
    fn stat_path_reports_file_and_directory() {
        let dir = make_fixture_dir();
        let file = dir.join("a.txt");

        let dir_info = stat_path(&dir).unwrap();
        assert_eq!(dir_info.kind, "directory");

        let file_info = stat_path(&file).unwrap();
        assert_eq!(file_info.kind, "file");
        assert_eq!(file_info.name, "a.txt");
        assert_eq!(file_info.size, 1);

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn read_text_file_accepts_utf8_and_rejects_binary() {
        let dir = make_fixture_dir();
        let text = dir.join("note.txt");
        let binary = dir.join("bin.dat");
        fs::write(&text, "hello\nLogan").unwrap();
        fs::write(&binary, b"a\0b").unwrap();

        assert_eq!(read_text_file(&text).unwrap(), "hello\nLogan");
        assert!(read_text_file(&binary)
            .unwrap_err()
            .to_string()
            .contains("binary"));

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn read_text_file_rejects_large_files() {
        let dir = make_fixture_dir();
        let large = dir.join("large.txt");
        fs::write(&large, vec![b'a'; (MAX_TEXT_FILE_BYTES + 1) as usize]).unwrap();

        assert!(read_text_file(&large)
            .unwrap_err()
            .to_string()
            .contains("larger than 1MB"));

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn write_text_file_updates_existing_file() {
        let dir = make_fixture_dir();
        let file = dir.join("a.txt");

        write_text_file(&file, "changed").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "changed");

        fs::remove_dir_all(dir).unwrap();
    }
}

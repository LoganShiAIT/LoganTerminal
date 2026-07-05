use serde::Serialize;
use std::path::{Path, PathBuf};

const MAX_TEXT_FILE_BYTES: u64 = 1024 * 1024;
/// Paste-as-file history cap — same lesson as the clipboard PNG store: any
/// file-backed history needs an eviction story or it grows forever.
const MAX_PASTE_FILES: usize = 50;

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

/// Writes clipboard text to `~/.logan-terminal/pastes/paste-<stamp>.txt`
/// and returns the path, so huge multi-line text can be handed to an agent
/// as a file path instead of a wall-of-text paste. The frontend supplies
/// the (cosmetic, time-sortable) stamp; uniqueness comes from the collision
/// suffix, and the dir is pruned to the newest MAX_PASTE_FILES.
#[tauri::command]
pub fn paste_to_file(contents: String, stamp: String) -> Result<String, String> {
    let dir = pastes_dir().ok_or("no home directory")?;
    let safe: String = stamp
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .take(32)
        .collect();
    let safe = if safe.is_empty() {
        "paste".to_string()
    } else {
        safe
    };
    paste_into_dir(&dir, &contents, &safe, MAX_PASTE_FILES)
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| e.to_string())
}

fn pastes_dir() -> Option<PathBuf> {
    let home = fs_home_dir();
    if home.is_empty() {
        return None;
    }
    Some(PathBuf::from(home).join(".logan-terminal").join("pastes"))
}

fn paste_into_dir(
    dir: &Path,
    contents: &str,
    stamp: &str,
    keep: usize,
) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let mut path = dir.join(format!("paste-{stamp}.txt"));
    let mut n = 1;
    while path.exists() {
        path = dir.join(format!("paste-{stamp}-{n}.txt"));
        n += 1;
    }
    std::fs::write(&path, contents)?;
    prune_paste_dir(dir, keep)?;
    Ok(path)
}

/// Deletes the oldest files (by mtime) beyond `keep`.
fn prune_paste_dir(dir: &Path, keep: usize) -> std::io::Result<()> {
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = std::fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .collect();
    if files.len() <= keep {
        return Ok(());
    }
    files.sort_by_key(|f| std::cmp::Reverse(f.0)); // newest first
    for (_, path) in files.split_off(keep) {
        let _ = std::fs::remove_file(path);
    }
    Ok(())
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

    #[test]
    fn paste_into_dir_writes_creates_dir_and_suffixes_collisions() {
        let dir = std::env::temp_dir().join(format!("logan-paste-test-{}", uuid::Uuid::new_v4()));
        let pastes = dir.join("pastes"); // does not exist yet

        let a = paste_into_dir(&pastes, "first", "20260704-190000", 50).unwrap();
        let b = paste_into_dir(&pastes, "second", "20260704-190000", 50).unwrap();

        assert_eq!(fs::read_to_string(&a).unwrap(), "first");
        assert_eq!(fs::read_to_string(&b).unwrap(), "second");
        assert_ne!(a, b, "same-stamp pastes must not overwrite");
        assert!(b.to_string_lossy().contains("20260704-190000-1"));

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn paste_dir_prunes_oldest_beyond_cap() {
        let dir = std::env::temp_dir().join(format!("logan-paste-prune-{}", uuid::Uuid::new_v4()));

        // Sequential writes have strictly increasing mtimes (ns resolution
        // on APFS/ext4); keep=3 must evict the two oldest.
        for i in 0..5 {
            paste_into_dir(&dir, &format!("v{i}"), &format!("stamp-{i}"), 3).unwrap();
        }

        let mut names: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(
            names,
            vec![
                "paste-stamp-2.txt".to_string(),
                "paste-stamp-3.txt".to_string(),
                "paste-stamp-4.txt".to_string(),
            ],
            "oldest two should be pruned"
        );

        fs::remove_dir_all(dir).unwrap();
    }
}

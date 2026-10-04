//! Plain filesystem operations: list a directory, stat a path, read and write
//! a text file. The guards here are what keep the review panel honest — it
//! only ever opens things it can actually render as text.

use serde::Serialize;
use std::io::Read;
use std::path::Path;

/// Above this a file is refused rather than loaded — the review panel is a
/// reader, not an editor for build artifacts. Mirrored in ReviewPanel.tsx.
pub const MAX_TEXT_FILE_BYTES: u64 = 1024 * 1024;

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

/// Directories first, then names — the order the file tree renders in.
pub fn list_dir_entries(path: &Path, show_hidden: bool) -> std::io::Result<Vec<FsEntry>> {
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

pub fn stat_path(path: &Path) -> std::io::Result<FsPathInfo> {
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

/// Text only, and bounded: a NUL byte or invalid UTF-8 is reported as an
/// error rather than rendered as mojibake.
pub fn read_text_file(path: &Path) -> std::io::Result<String> {
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

    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(MAX_TEXT_FILE_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_TEXT_FILE_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "file is larger than 1MB",
        ));
    }
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

/// Overwrites an existing file only — the panel edits what it opened, it does
/// not create new paths.
pub fn write_text_file(path: &Path, contents: &str) -> std::io::Result<()> {
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

/// Local image URLs resolve against the document's captured directory.
pub fn resolve_image(target: &str, base_dir: Option<&str>) -> Result<String, String> {
    let path = if target.starts_with("file:") {
        url::Url::parse(target)
            .map_err(|e| e.to_string())?
            .to_file_path()
            .map_err(|_| "Invalid file URI")?
    } else {
        if target.contains("://") || target.starts_with("data:") {
            return Err("Remote images are opened externally".into());
        }
        let local = std::path::Path::new(target);
        let resolved = if local.is_absolute() {
            std::path::PathBuf::from(local)
        } else {
            std::path::PathBuf::from(base_dir.ok_or("Relative image has no source directory")?)
                .join(local)
        };
        if target.contains('%') {
            let base = url::Url::from_directory_path(if local.is_absolute() {
                std::path::Path::new("/")
            } else {
                std::path::Path::new(base_dir.ok_or("Relative image has no source directory")?)
            })
            .map_err(|_| "Invalid source directory")?;
            base.join(target)
                .map_err(|e| e.to_string())?
                .to_file_path()
                .map_err(|_| "Invalid image path")?
        } else {
            resolved
        }
    };
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    if !canonical.is_file() {
        return Err("Image is not a file".into());
    }
    let ext = canonical
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(
        ext.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "avif"
    ) {
        return Err("Unsupported image format".into());
    }
    Ok(canonical.to_string_lossy().into_owned())
}

#[cfg(test)]
mod reader_tests {
    use super::*;
    use std::fs;
    #[test]
    fn resolves_chinese_space_relative_uri_and_alias_images() {
        let dir = std::env::temp_dir().join(format!("logan-reader-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(dir.join("报告")).unwrap();
        fs::create_dir_all(dir.join("图 空格")).unwrap();
        let image = dir.join("图 空格").join("矩阵.svg");
        fs::write(&image, "<svg xmlns='http://www.w3.org/2000/svg'/>").unwrap();
        let expected = image.canonicalize().unwrap().to_string_lossy().into_owned();
        let base = dir.join("报告").to_string_lossy().into_owned();
        assert_eq!(
            resolve_image("../图 空格/矩阵.svg", Some(&base)).unwrap(),
            expected
        );
        let uri = url::Url::from_file_path(&image).unwrap();
        assert_eq!(resolve_image(uri.as_str(), None).unwrap(), expected);
        assert_eq!(
            resolve_image("../图%20空格/矩阵.svg", Some(&base)).unwrap(),
            expected
        );
        assert!(resolve_image("../图 空格/矩阵.svg", None).is_err());
        assert!(resolve_image("https://example.com/image.png", Some(&base)).is_err());
        assert!(resolve_image("missing.png", Some(&base)).is_err());
        #[cfg(unix)]
        {
            let alias = dir.join("alias.svg");
            std::os::unix::fs::symlink(&image, &alias).unwrap();
            assert_eq!(
                resolve_image(alias.to_str().unwrap(), None).unwrap(),
                expected
            );
        }
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn accepts_utf8_byte_boundary_and_rejects_invalid_text() {
        let dir = std::env::temp_dir().join(format!("logan-reader-limit-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("中文 空格.md");
        let text = "中".repeat((MAX_TEXT_FILE_BYTES / 3) as usize) + "a";
        assert_eq!(text.len(), MAX_TEXT_FILE_BYTES as usize);
        fs::write(&path, &text).unwrap();
        assert_eq!(read_text_file(&path).unwrap().len(), text.len());
        fs::write(&path, text + "b").unwrap();
        assert!(read_text_file(&path).is_err());
        fs::write(&path, [0xff, 0xfe]).unwrap();
        assert!(read_text_file(&path)
            .unwrap_err()
            .to_string()
            .contains("UTF-8"));
        fs::remove_dir_all(dir).unwrap();
    }
}

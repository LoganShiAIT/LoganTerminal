//! Paste-as-file: huge multi-line clipboard text becomes a file under
//! `~/.logan-terminal/pastes/`, so it can be handed to an agent as a path
//! instead of a wall of text.
//!
//! Same lesson as the clipboard PNG store: any file-backed history needs an
//! eviction story or it grows forever — hence [`prune_paste_dir`].

use std::path::{Path, PathBuf};

pub const MAX_PASTE_FILES: usize = 50;

/// Keeps only what can safely become a filename; uniqueness comes from the
/// collision suffix in [`paste_into_dir`], so the stamp is purely cosmetic
/// (and time-sortable).
pub fn sanitize_stamp(stamp: &str) -> String {
    let safe: String = stamp
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .take(32)
        .collect();
    if safe.is_empty() {
        "paste".to_string()
    } else {
        safe
    }
}

pub fn paste_into_dir(
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn sanitize_stamp_strips_unsafe_chars_and_never_empties() {
        assert_eq!(sanitize_stamp("20260704-190000"), "20260704-190000");
        assert_eq!(sanitize_stamp("../etc/passwd"), "etcpasswd");
        assert_eq!(sanitize_stamp("!!!"), "paste");
        assert_eq!(sanitize_stamp("").len(), "paste".len());
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

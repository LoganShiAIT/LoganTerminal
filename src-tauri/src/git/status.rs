//! Working-tree dirty state — the counts behind the branch chip, refreshed on
//! every OSC 7 prompt event.

use super::repo::{branch_for, quotepath_args, run_git};
use std::path::Path;

#[derive(serde::Serialize, Debug, PartialEq, Clone, Copy, Default)]
pub struct DirtyCounts {
    pub added: u32,
    pub modified: u32,
    pub deleted: u32,
}

/// Count `git status --porcelain` (v1) lines into the three buckets a status
/// chip can show. Untracked directories count as 1, same as `git status`
/// shows them. Priority per line: untracked → deleted (either side, so `AD`
/// nets out as gone) → staged-add → everything else is "modified" (edits,
/// renames, type changes, conflicts).
pub fn parse_status_porcelain(s: &str) -> DirtyCounts {
    let mut c = DirtyCounts::default();
    for line in s.lines() {
        let b = line.as_bytes();
        if b.len() < 3 {
            continue;
        }
        let (x, y) = (b[0], b[1]);
        if x == b'?' {
            c.added += 1;
        } else if x == b'D' || y == b'D' {
            c.deleted += 1;
        } else if x == b'A' {
            c.added += 1;
        } else {
            c.modified += 1;
        }
    }
    c
}

#[derive(serde::Serialize, Debug)]
pub struct GitStatusInfo {
    pub branch: String,
    /// None = `git status` itself failed (git missing?); the branch chip
    /// still renders, just without counts.
    pub dirty: Option<DirtyCounts>,
}

/// Branch + dirty counts in one round trip. `None` = not a repository. The
/// cheap `.git/HEAD` read gates the subprocess: no repo, no fork.
pub fn status_impl(dir: &Path) -> Option<GitStatusInfo> {
    let branch = branch_for(dir)?;
    let dirty = run_git(dir, quotepath_args(["status", "--porcelain"]))
        .ok()
        .map(|out| parse_status_porcelain(&out));
    Some(GitStatusInfo { branch, dirty })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::testutil::{commit_all, init_repo, make_temp};
    use std::fs;

    #[test]
    fn status_porcelain_counts_by_bucket() {
        let s = "?? new.txt\n M mod.txt\nM  staged.txt\nA  added.txt\n D del.txt\nD  delstaged.txt\nAD ghost.txt\nR  a -> b\nUU conflict.txt\n";
        assert_eq!(
            parse_status_porcelain(s),
            DirtyCounts {
                added: 2,    // ?? + A
                deleted: 3,  // _D + D_ + AD
                modified: 4, // _M + M_ + R + UU
            }
        );
        assert_eq!(parse_status_porcelain(""), DirtyCounts::default());
    }

    #[test]
    fn git_status_reports_branch_and_dirty_counts() {
        let container = make_temp().canonicalize().unwrap();
        let repo = init_repo(&container);

        let clean = status_impl(&repo).unwrap();
        assert_eq!(clean.branch, "main");
        assert_eq!(clean.dirty, Some(DirtyCounts::default()));

        fs::write(repo.join("a.txt"), "one\n").unwrap();
        commit_all(&repo, "add a");
        fs::write(repo.join("a.txt"), "one\ntwo\n").unwrap(); // modified
        fs::write(repo.join("b.txt"), "new\n").unwrap(); // untracked
        let dirty = status_impl(&repo).unwrap().dirty.unwrap();
        assert_eq!(
            dirty,
            DirtyCounts {
                added: 1,
                modified: 1,
                deleted: 0
            }
        );

        // Not a repo → None (chip hidden).
        let plain = make_temp();
        assert!(status_impl(&plain).is_none());

        fs::remove_dir_all(&container).unwrap();
        fs::remove_dir_all(&plain).unwrap();
    }
}

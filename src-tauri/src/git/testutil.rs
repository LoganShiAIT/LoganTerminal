//! Fixtures shared by the git submodules' tests: throwaway repositories on
//! disk. Every helper panics on failure — a broken fixture is a broken test,
//! not a condition worth threading a Result through.

use super::repo::run_git;
use std::fs;
use std::path::{Path, PathBuf};

/// A fresh, empty directory under the OS temp dir. Callers clean up.
pub fn make_temp() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("logan-git-test-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// Fake just enough of a repository for the `.git/HEAD` reader to work.
pub fn write_head(git_dir: &Path, contents: &str) {
    fs::create_dir_all(git_dir).unwrap();
    fs::write(git_dir.join("HEAD"), contents).unwrap();
}

/// Real repo at `<container>/repo` with one commit, so HEAD is born and
/// worktrees can be added.
pub fn init_repo(container: &Path) -> PathBuf {
    let repo = container.join("repo");
    fs::create_dir_all(&repo).unwrap();
    run_git(&repo, ["init", "-b", "main"]).unwrap();
    run_git(
        &repo,
        [
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "commit",
            "--allow-empty",
            "-m",
            "init",
        ],
    )
    .unwrap();
    repo
}

/// `git add -A && git commit`, with the inline identity `init_repo` uses —
/// CI machines have no global git identity configured.
pub fn commit_all(repo: &Path, msg: &str) {
    run_git(repo, ["add", "-A"]).unwrap();
    run_git(
        repo,
        [
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "commit",
            "-m",
            msg,
        ],
    )
    .unwrap();
}

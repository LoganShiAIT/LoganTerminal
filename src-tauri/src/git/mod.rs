//! Git integration, split by the question each part answers:
//!
//! - [`repo`] — where is the repository, what branch is it on, and how do we
//!   call git at all (every other submodule builds on this).
//! - [`status`] — how dirty is the working tree right now.
//! - [`diff`] — what is different (working tree, or this branch vs its base).
//! - [`log`] — how did it get there (commit history + per-commit diffs).
//! - [`worktree`] — the parallel-task flows: add, list, remove, merge.
//!
//! This file holds the whole IPC surface: every `#[tauri::command]` the
//! frontend can reach, each a thin wrapper over an `_impl` in a submodule.
//! Keeping them here means the submodules stay plain Rust — directly
//! callable and testable without a Tauri app — and `lib.rs` keeps naming
//! commands as `git::git_*` no matter which file the logic moves to.

mod diff;
mod log;
mod repo;
mod status;
mod worktree;

#[cfg(test)]
mod testutil;

use diff::DiffSummary;
use log::CommitLog;
use status::GitStatusInfo;
use std::path::Path;
use worktree::{WorktreeCreated, WorktreeEntry};

/// Branch + dirty counts in one round trip — refreshed on every OSC 7 prompt
/// event. `None` = not a repository.
#[tauri::command]
pub fn git_status(cwd: String) -> Option<GitStatusInfo> {
    status::status_impl(Path::new(&cwd))
}

#[tauri::command]
pub fn git_diff_summary(cwd: String, mode: String) -> Result<DiffSummary, String> {
    diff::diff_summary_impl(Path::new(&cwd), &mode)
}

#[tauri::command]
pub fn git_diff_file(
    cwd: String,
    mode: String,
    path: String,
    untracked: bool,
) -> Result<String, String> {
    diff::diff_file_impl(Path::new(&cwd), &mode, &path, untracked)
}

#[tauri::command]
pub fn git_log(cwd: String, limit: u32) -> Result<CommitLog, String> {
    log::log_impl(Path::new(&cwd), limit)
}

#[tauri::command]
pub fn git_commit_summary(cwd: String, hash: String) -> Result<DiffSummary, String> {
    log::commit_summary_impl(Path::new(&cwd), &hash)
}

#[tauri::command]
pub fn git_commit_file(cwd: String, hash: String, path: String) -> Result<String, String> {
    log::commit_file_impl(Path::new(&cwd), &hash, &path)
}

#[tauri::command]
pub fn git_worktree_add(cwd: String, task: String) -> Result<WorktreeCreated, String> {
    worktree::worktree_add_impl(Path::new(&cwd), &task)
}

#[tauri::command]
pub fn git_worktree_list(cwd: String) -> Result<Vec<WorktreeEntry>, String> {
    worktree::worktree_list_impl(Path::new(&cwd))
}

/// Non-force only, by design: git refuses to remove a dirty or locked
/// worktree, and that refusal is the safety model. A clean removal loses
/// nothing — the branch and its commits survive.
#[tauri::command]
pub fn git_worktree_remove(cwd: String, path: String) -> Result<(), String> {
    worktree::worktree_remove_impl(Path::new(&cwd), &path)
}

#[tauri::command]
pub fn git_worktree_merge(cwd: String, path: String, branch: String) -> Result<String, String> {
    worktree::worktree_merge_impl(Path::new(&cwd), &path, &branch)
}

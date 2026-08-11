//! Parallel-task worktrees: add, list, remove, merge.
//!
//! The convention throughout is a sibling directory (`<repo>-worktrees/<task>`)
//! so the repository itself stays clean — no .gitignore edits — while the
//! worktrees remain easy to find and remove. Destructive operations are
//! non-force by design: git refusing a dirty or locked tree *is* the safety
//! model, and its refusal is what the user sees.

use super::repo::{main_repo_root, run_git};
use std::path::{Path, PathBuf};

/// Task name → branch/directory name. Whitespace runs become `-`; Unicode
/// alphanumerics plus `._-` survive (Chinese task names work); `/` is
/// deliberately dropped so the `..`/leading-slash class of ref hazards can't
/// occur; `.`/`-` runs collapse; edges are trimmed; a `.lock` suffix (git
/// refuses it) is stripped. `None` = nothing usable left.
/// Mirrored in `src/lib/worktree.ts` for the live preview — keep the fixture
/// tables in both test suites identical.
pub fn sanitize_task(name: &str) -> Option<String> {
    let mut kept = String::new();
    let mut pending_sep = false;
    for ch in name.trim().chars() {
        if ch.is_whitespace() {
            pending_sep = true;
            continue;
        }
        if pending_sep {
            kept.push('-');
            pending_sep = false;
        }
        if ch.is_alphanumeric() || matches!(ch, '.' | '_' | '-') {
            kept.push(ch);
        }
    }
    let mut collapsed = String::new();
    let mut last: Option<char> = None;
    for ch in kept.chars() {
        if matches!(ch, '.' | '-') && last == Some(ch) {
            continue;
        }
        collapsed.push(ch);
        last = Some(ch);
    }
    let edge = |c: char| matches!(c, '.' | '-');
    let trimmed = collapsed.trim_matches(edge);
    let base = trimmed.strip_suffix(".lock").unwrap_or(trimmed);
    let base = base.trim_matches(edge);
    if base.is_empty() {
        None
    } else {
        Some(base.to_string())
    }
}

#[derive(serde::Serialize, Debug)]
pub struct WorktreeCreated {
    pub path: String,
    pub branch: String,
}

/// `git worktree add <main-parent>/<repo>-worktrees/<task> -b <task>`.
pub fn worktree_add_impl(cwd: &Path, task: &str) -> Result<WorktreeCreated, String> {
    let branch = sanitize_task(task).ok_or("invalid task name")?;
    let root = main_repo_root(cwd)?;
    let name = root
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("unsupported repository layout")?;
    let container = root
        .parent()
        .ok_or("repository has no parent directory")?
        .join(format!("{name}-worktrees"));
    std::fs::create_dir_all(&container).map_err(|e| e.to_string())?;
    let path = container.join(&branch);
    let os = std::ffi::OsStr::new;
    run_git(
        cwd,
        [
            os("worktree"),
            os("add"),
            path.as_os_str(),
            os("-b"),
            os(&branch),
        ],
    )?;
    Ok(WorktreeCreated {
        path: path.to_string_lossy().into_owned(),
        branch,
    })
}

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct WorktreeEntry {
    pub path: String,
    pub branch: Option<String>,
    pub is_main: bool,
}

/// Parse `git worktree list --porcelain` blocks. Git lists the main worktree
/// first; a detached entry has no `branch` line, so `branch` stays None.
pub fn parse_worktree_list(porcelain: &str) -> Vec<WorktreeEntry> {
    let mut entries: Vec<WorktreeEntry> = Vec::new();
    for block in porcelain.split("\n\n") {
        let mut path: Option<String> = None;
        let mut branch: Option<String> = None;
        for line in block.lines() {
            if let Some(p) = line.strip_prefix("worktree ") {
                path = Some(p.to_string());
            } else if let Some(b) = line.strip_prefix("branch ") {
                branch = Some(b.strip_prefix("refs/heads/").unwrap_or(b).to_string());
            }
        }
        if let Some(path) = path {
            entries.push(WorktreeEntry {
                path,
                branch,
                is_main: entries.is_empty(),
            });
        }
    }
    entries
}

/// The main worktree governing `cwd` — the one whose branch the diff and log
/// views treat as the base to compare against.
pub fn main_worktree(cwd: &Path) -> Result<WorktreeEntry, String> {
    let out = run_git(cwd, ["worktree", "list", "--porcelain"])?;
    parse_worktree_list(&out)
        .into_iter()
        .find(|e| e.is_main)
        .ok_or_else(|| "cannot locate the main worktree".to_string())
}

/// Branch of [`main_worktree`] — what "branch mode" diffs against.
pub fn base_branch(cwd: &Path) -> Result<String, String> {
    main_worktree(cwd)?
        .branch
        .ok_or_else(|| "main worktree is on a detached HEAD".to_string())
}

/// Finish a worktree task: merge its branch into the main worktree's
/// checked-out branch, remove the worktree, safe-delete the branch.
///
/// Safety model, same spirit as the non-force remove: a dirty worktree
/// refuses the whole flow up front, and a conflicting merge is aborted
/// automatically so a one-click action can never leave conflict markers in
/// the main checkout. `--no-edit` because a GUI process has no editor for
/// the merge-commit message. Fast-forward merges (the common case for a
/// worktree branched off main) need no committer identity at all.
pub fn worktree_merge_impl(cwd: &Path, path: &str, branch: &str) -> Result<String, String> {
    let wt_status = run_git(Path::new(path), ["status", "--porcelain"])?;
    if !wt_status.is_empty() {
        return Err("the worktree has uncommitted changes — commit or stash them first".into());
    }
    let main = main_worktree(cwd)?;
    let main_branch = main
        .branch
        .ok_or("main worktree is on a detached HEAD — check out a branch there first")?;
    let main_dir = PathBuf::from(&main.path);
    if let Err(e) = run_git(&main_dir, ["merge", "--no-edit", branch]) {
        // Best-effort: errors before the merge starts leave nothing to abort.
        let _ = run_git(&main_dir, ["merge", "--abort"]);
        return Err(format!(
            "{e}\n(merge aborted — the main checkout is untouched)"
        ));
    }
    run_git(&main_dir, ["worktree", "remove", path])
        .map_err(|e| format!("merged into {main_branch}, but couldn't remove the worktree: {e}"))?;
    match run_git(&main_dir, ["branch", "-d", branch]) {
        Ok(_) => Ok(format!(
            "Merged {branch} into {main_branch} — worktree removed, branch deleted"
        )),
        Err(e) => Ok(format!(
            "Merged {branch} into {main_branch} — worktree removed; branch kept ({e})"
        )),
    }
}

pub fn worktree_list_impl(cwd: &Path) -> Result<Vec<WorktreeEntry>, String> {
    let out = run_git(cwd, ["worktree", "list", "--porcelain"])?;
    Ok(parse_worktree_list(&out))
}

/// Non-force only: git refuses to remove a dirty or locked worktree, and that
/// refusal is the safety model. A clean removal loses nothing — the branch
/// and its commits survive.
pub fn worktree_remove_impl(cwd: &Path, path: &str) -> Result<(), String> {
    let os = std::ffi::OsStr::new;
    run_git(cwd, [os("worktree"), os("remove"), os(path)]).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::repo::{branch_for, tidy};
    use crate::git::testutil::{commit_all, init_repo, make_temp};
    use std::fs;

    #[test]
    fn sanitize_task_fixture_table() {
        // Keep identical to the table in src/lib/worktree.test.ts.
        let cases = [
            ("Fix Login Flow", Some("Fix-Login-Flow")),
            ("  padded   name ", Some("padded-name")),
            ("wt/../etc", Some("wt.etc")),
            ("修复登录", Some("修复登录")),
            ("a--b..c", Some("a-b.c")),
            ("...task...", Some("task")),
            ("task.lock", Some("task")),
            ("-lead-trail-", Some("lead-trail")),
            ("@#$%", None),
            ("", None),
            ("   ", None),
        ];
        for (input, want) in cases {
            assert_eq!(sanitize_task(input).as_deref(), want, "input: {input:?}");
        }
    }

    #[test]
    fn parses_worktree_porcelain_blocks() {
        let porcelain = "worktree /repo\nHEAD abc\nbranch refs/heads/main\n\n\
                         worktree /repo-worktrees/x\nHEAD def\nbranch refs/heads/feat/x\n\n\
                         worktree /detached-one\nHEAD 123\ndetached\n";
        let entries = parse_worktree_list(porcelain);
        assert_eq!(entries.len(), 3);
        assert!(entries[0].is_main);
        assert!(!entries[1].is_main);
        assert_eq!(entries[0].branch.as_deref(), Some("main"));
        assert_eq!(entries[1].branch.as_deref(), Some("feat/x"));
        assert_eq!(entries[2].branch, None);
        assert_eq!(entries[2].path, "/detached-one");
        assert!(parse_worktree_list("").is_empty());
    }

    #[test]
    fn worktree_add_list_remove_roundtrip() {
        // tidy(): raw canonicalize() yields \\?\-verbatim paths on Windows,
        // while the implementation strips that prefix — expected paths must
        // go through the same normalization (first caught on the Windows CI
        // runner, 2026-07-05).
        let container = tidy(make_temp().canonicalize().unwrap());
        let repo = init_repo(&container);

        let created = worktree_add_impl(&repo, "Fix Login Flow").unwrap();
        assert_eq!(created.branch, "Fix-Login-Flow");
        let expected = container.join("repo-worktrees").join("Fix-Login-Flow");
        assert_eq!(PathBuf::from(&created.path), expected);
        assert!(expected.is_dir());
        // The existing HEAD reader agrees (.git-file redirection works).
        assert_eq!(branch_for(&expected).as_deref(), Some("Fix-Login-Flow"));

        let listed =
            parse_worktree_list(&run_git(&repo, ["worktree", "list", "--porcelain"]).unwrap());
        assert_eq!(listed.len(), 2);
        assert!(listed[0].is_main);
        assert_eq!(listed[1].branch.as_deref(), Some("Fix-Login-Flow"));

        // Creating from INSIDE a worktree still lands in the main repo's
        // sibling container (common-dir resolution).
        let second = worktree_add_impl(&expected, "second-task").unwrap();
        assert_eq!(
            PathBuf::from(&second.path),
            container.join("repo-worktrees").join("second-task")
        );

        // Dirty worktree: the non-force removal must refuse...
        fs::write(expected.join("scratch.txt"), "wip").unwrap();
        assert!(worktree_remove_impl(&repo, &created.path).is_err());
        // ...and succeed once clean.
        fs::remove_file(expected.join("scratch.txt")).unwrap();
        worktree_remove_impl(&repo, &created.path).unwrap();
        assert!(!expected.exists());

        fs::remove_dir_all(&container).unwrap();
    }

    #[test]
    fn worktree_add_rejects_bad_names_duplicates_and_non_repos() {
        let container = make_temp().canonicalize().unwrap();
        let repo = init_repo(&container);

        assert!(worktree_add_impl(&repo, "@#$%")
            .unwrap_err()
            .contains("invalid task name"));

        worktree_add_impl(&repo, "dup").unwrap();
        // Second add with the same name: git's own "already exists" error.
        assert!(worktree_add_impl(&repo, "dup").is_err());

        let plain = make_temp();
        assert!(worktree_add_impl(&plain, "task").is_err());

        fs::remove_dir_all(&container).unwrap();
        fs::remove_dir_all(&plain).unwrap();
    }

    #[test]
    fn worktree_merge_roundtrip_ff() {
        let container = make_temp().canonicalize().unwrap();
        let repo = init_repo(&container);
        fs::write(repo.join("base.txt"), "base\n").unwrap();
        commit_all(&repo, "base");

        let created = worktree_add_impl(&repo, "task").unwrap();
        let wt = PathBuf::from(&created.path);
        fs::write(wt.join("done.txt"), "done\n").unwrap();
        commit_all(&wt, "task done");

        let msg = worktree_merge_impl(&repo, &created.path, &created.branch).unwrap();
        assert!(msg.contains("Merged task into main"), "got: {msg}");
        assert!(msg.contains("branch deleted"), "got: {msg}");
        // The work landed in main, the worktree is gone, the branch is gone.
        assert!(repo.join("done.txt").is_file());
        assert!(!wt.exists());
        assert_eq!(run_git(&repo, ["branch", "--list", "task"]).unwrap(), "");

        fs::remove_dir_all(&container).unwrap();
    }

    #[test]
    fn worktree_merge_refuses_dirty_and_aborts_conflicts() {
        let container = make_temp().canonicalize().unwrap();
        let repo = init_repo(&container);
        fs::write(repo.join("f.txt"), "original\n").unwrap();
        commit_all(&repo, "base");

        let created = worktree_add_impl(&repo, "clash").unwrap();
        let wt = PathBuf::from(&created.path);

        // Dirty worktree: refused up front, nothing touched.
        fs::write(wt.join("wip.txt"), "wip\n").unwrap();
        let err = worktree_merge_impl(&repo, &created.path, &created.branch).unwrap_err();
        assert!(err.contains("uncommitted"), "got: {err}");
        fs::remove_file(wt.join("wip.txt")).unwrap();

        // Conflicting histories: merge fails, auto-abort leaves main clean.
        fs::write(wt.join("f.txt"), "worktree version\n").unwrap();
        commit_all(&wt, "wt edit");
        fs::write(repo.join("f.txt"), "main version\n").unwrap();
        commit_all(&repo, "main edit");

        let err = worktree_merge_impl(&repo, &created.path, &created.branch).unwrap_err();
        assert!(err.contains("merge aborted"), "got: {err}");
        // Main checkout untouched: clean status, original content, and the
        // worktree + branch both survive for manual resolution.
        assert_eq!(run_git(&repo, ["status", "--porcelain"]).unwrap(), "");
        assert_eq!(
            fs::read_to_string(repo.join("f.txt")).unwrap(),
            "main version\n"
        );
        assert!(wt.exists());
        assert_ne!(run_git(&repo, ["branch", "--list", "clash"]).unwrap(), "");

        fs::remove_dir_all(&container).unwrap();
    }
}

//! Repository discovery and the one way this crate talks to git.
//!
//! Two very different mechanisms live here on purpose. [`branch_for`] reads
//! `.git/HEAD` directly — it runs on every prompt, so it must not fork a
//! process. Everything else shells out to real git, whose error messages
//! ("not a git repository", "already exists", "contains modified or untracked
//! files") are the user-facing errors, verbatim.

use std::path::{Path, PathBuf};

/// Locate the git directory governing `start`, walking up the tree.
///
/// `.git` is usually a directory, but linked worktrees and submodules use a
/// `.git` *file* containing `gitdir: <path>` (relative paths resolve against
/// the directory holding the file). For worktrees that target
/// `<main>/.git/worktrees/<name>`, which carries its own per-worktree `HEAD` —
/// exactly the one we want.
pub fn find_git_dir(start: &Path) -> Option<PathBuf> {
    let mut cur = Some(start);
    while let Some(dir) = cur {
        let dotgit = dir.join(".git");
        if dotgit.is_dir() {
            return Some(dotgit);
        }
        if dotgit.is_file() {
            let contents = std::fs::read_to_string(&dotgit).ok()?;
            let target = contents.trim().strip_prefix("gitdir:")?.trim();
            let p = PathBuf::from(target);
            return Some(if p.is_absolute() { p } else { dir.join(p) });
        }
        cur = dir.parent();
    }
    None
}

/// Current branch of the repository containing `dir`, read straight from
/// `.git/HEAD` — no subprocess, no libgit2. Returns the branch name for
/// `ref: refs/heads/<name>` (only that prefix is stripped, so slashed names
/// like `feature/foo` survive), a 7-char short hash for a detached HEAD, and
/// `None` outside a repository or on unreadable/unrecognized HEAD content.
pub fn branch_for(dir: &Path) -> Option<String> {
    let git_dir = find_git_dir(dir)?;
    let head = std::fs::read_to_string(git_dir.join("HEAD")).ok()?;
    let head = head.trim();
    if let Some(target) = head.strip_prefix("ref: ") {
        let name = target
            .trim()
            .strip_prefix("refs/heads/")
            .unwrap_or(target.trim());
        if name.is_empty() {
            return None;
        }
        return Some(name.to_string());
    }
    if head.len() >= 7 && head.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Some(head[..7].to_string());
    }
    None
}

pub fn run_git_raw<I, S>(dir: &Path, args: I) -> Result<std::process::Output, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let mut cmd = std::process::Command::new("git");
    cmd.arg("-C").arg(dir).args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW — a GUI app must not flash console windows.
        cmd.creation_flags(0x0800_0000);
    }
    cmd.output().map_err(|e| format!("failed to run git: {e}"))
}

pub fn run_git<I, S>(dir: &Path, args: I) -> Result<String, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let out = run_git_raw(dir, args)?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        // `git merge` reports conflicts on stdout with an empty stderr, so
        // fall back to stdout before the bare status code.
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let err = if err.is_empty() {
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        } else {
            err
        };
        Err(if err.is_empty() {
            format!("git exited with {}", out.status)
        } else {
            err
        })
    }
}

/// `core.quotepath=false` on every path-emitting call, so non-ASCII paths
/// (中文 filenames) come out as raw UTF-8 instead of octal escapes.
pub fn quotepath_args<'a>(rest: impl IntoIterator<Item = &'a str>) -> Vec<&'a str> {
    let mut args = vec!["-c", "core.quotepath=false"];
    args.extend(rest);
    args
}

/// With quotepath off, only paths holding control chars/quotes/backslashes
/// stay C-quoted; strip the wrap so they at least display sanely.
pub fn unquote_path(p: &str) -> String {
    let t = p.trim();
    if t.len() >= 2 && t.starts_with('"') && t.ends_with('"') {
        t[1..t.len() - 1].to_string()
    } else {
        t.to_string()
    }
}

/// Windows canonicalize() returns `\\?\`-prefixed verbatim paths; strip the
/// prefix so paths stay readable in the UI and usable as plain git args.
pub fn tidy(p: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let s = p.to_string_lossy();
        if let Some(rest) = s.strip_prefix(r"\\?\") {
            return PathBuf::from(rest);
        }
    }
    p
}

/// Root of the *main* repository governing `cwd` — correct even when `cwd`
/// is inside a linked worktree (`--git-common-dir` always points at the main
/// `.git`). Relative output resolves against the queried dir.
pub fn main_repo_root(cwd: &Path) -> Result<PathBuf, String> {
    let common = run_git(cwd, ["rev-parse", "--git-common-dir"])?;
    let common_path = PathBuf::from(&common);
    let abs = if common_path.is_absolute() {
        common_path
    } else {
        cwd.join(common_path)
    };
    let canon = tidy(
        abs.canonicalize()
            .map_err(|e| format!("cannot resolve git dir: {e}"))?,
    );
    canon
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "unsupported repository layout".to_string())
}

/// Root of the worktree containing `cwd`.
///
/// Every path in a diff summary is relative to this, and every per-file git
/// call runs from here. That matters because the two halves of git disagree:
/// `git diff` *prints* repo-root-relative paths but *resolves* pathspecs
/// against the process's directory, so a shell sitting in a subdirectory would
/// otherwise hand a path straight back to git and be told it does not exist.
pub fn repo_root(cwd: &Path) -> Result<PathBuf, String> {
    Ok(PathBuf::from(run_git(
        cwd,
        ["rev-parse", "--show-toplevel"],
    )?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::testutil::{make_temp, write_head};
    use std::fs;

    #[test]
    fn reads_branch_from_head_ref() {
        let repo = make_temp();
        write_head(&repo.join(".git"), "ref: refs/heads/main\n");
        assert_eq!(branch_for(&repo).as_deref(), Some("main"));
        fs::remove_dir_all(repo).unwrap();
    }

    #[test]
    fn keeps_slashes_in_branch_names() {
        let repo = make_temp();
        write_head(&repo.join(".git"), "ref: refs/heads/feature/login-shell\n");
        assert_eq!(branch_for(&repo).as_deref(), Some("feature/login-shell"));
        fs::remove_dir_all(repo).unwrap();
    }

    #[test]
    fn walks_up_from_nested_directories() {
        let repo = make_temp();
        write_head(&repo.join(".git"), "ref: refs/heads/dev\n");
        let nested = repo.join("src").join("components");
        fs::create_dir_all(&nested).unwrap();
        assert_eq!(branch_for(&nested).as_deref(), Some("dev"));
        fs::remove_dir_all(repo).unwrap();
    }

    #[test]
    fn detached_head_yields_short_hash() {
        let repo = make_temp();
        write_head(
            &repo.join(".git"),
            "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678\n",
        );
        assert_eq!(branch_for(&repo).as_deref(), Some("a1b2c3d"));
        fs::remove_dir_all(repo).unwrap();
    }

    #[test]
    fn follows_worktree_gitdir_file_absolute_and_relative() {
        let root = make_temp();
        // Main repo layout with a linked worktree's private dir.
        let wt_git_dir = root.join("main/.git/worktrees/feature-x");
        write_head(&wt_git_dir, "ref: refs/heads/feature-x\n");

        // Absolute gitdir pointer.
        let wt_abs = root.join("wt-abs");
        fs::create_dir_all(&wt_abs).unwrap();
        fs::write(
            wt_abs.join(".git"),
            format!("gitdir: {}\n", wt_git_dir.display()),
        )
        .unwrap();
        assert_eq!(branch_for(&wt_abs).as_deref(), Some("feature-x"));

        // Relative gitdir pointer (resolved against the worktree dir).
        let wt_rel = root.join("wt-rel");
        fs::create_dir_all(&wt_rel).unwrap();
        fs::write(
            wt_rel.join(".git"),
            "gitdir: ../main/.git/worktrees/feature-x\n",
        )
        .unwrap();
        assert_eq!(branch_for(&wt_rel).as_deref(), Some("feature-x"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn non_repo_and_garbage_head_yield_none() {
        let plain = make_temp();
        assert_eq!(branch_for(&plain), None);

        let weird = make_temp();
        write_head(&weird.join(".git"), "something unexpected\n");
        assert_eq!(branch_for(&weird), None);

        let empty_ref = make_temp();
        write_head(&empty_ref.join(".git"), "ref: \n");
        assert_eq!(branch_for(&empty_ref), None);

        fs::remove_dir_all(plain).unwrap();
        fs::remove_dir_all(weird).unwrap();
        fs::remove_dir_all(empty_ref).unwrap();
    }
}

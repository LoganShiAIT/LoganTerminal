use std::path::{Path, PathBuf};

/// Locate the git directory governing `start`, walking up the tree.
///
/// `.git` is usually a directory, but linked worktrees and submodules use a
/// `.git` *file* containing `gitdir: <path>` (relative paths resolve against
/// the directory holding the file). For worktrees that target
/// `<main>/.git/worktrees/<name>`, which carries its own per-worktree `HEAD` —
/// exactly the one we want.
fn find_git_dir(start: &Path) -> Option<PathBuf> {
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

/// Branch name for a pane's cwd; `None` means "not a repo" (also the safe
/// answer for any read/parse hiccup — the UI just hides the chip).
#[tauri::command]
pub fn git_branch(cwd: String) -> Option<String> {
    branch_for(Path::new(&cwd))
}

// ---------------------------------------------------------------------------
// Worktree flows (Phase 11). Unlike the read-only branch lookup above, these
// shell out to real git — its error messages ("already exists", "contains
// modified or untracked files", "not a git repository") are the user-facing
// errors, verbatim.

fn run_git<I, S>(dir: &Path, args: I) -> Result<String, String>
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
    let out = cmd
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if err.is_empty() {
            format!("git exited with {}", out.status)
        } else {
            err
        })
    }
}

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

/// Windows canonicalize() returns `\\?\`-prefixed verbatim paths; strip the
/// prefix so paths stay readable in the UI and usable as plain git args.
fn tidy(p: PathBuf) -> PathBuf {
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
fn main_repo_root(cwd: &Path) -> Result<PathBuf, String> {
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

#[derive(serde::Serialize, Debug)]
pub struct WorktreeCreated {
    pub path: String,
    pub branch: String,
}

/// `git worktree add <main-parent>/<repo>-worktrees/<task> -b <task>` — the
/// sibling-directory convention keeps the repo itself clean (no .gitignore
/// edits) while keeping worktrees easy to find and remove.
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

#[tauri::command]
pub fn git_worktree_add(cwd: String, task: String) -> Result<WorktreeCreated, String> {
    worktree_add_impl(Path::new(&cwd), &task)
}

#[tauri::command]
pub fn git_worktree_list(cwd: String) -> Result<Vec<WorktreeEntry>, String> {
    let out = run_git(Path::new(&cwd), ["worktree", "list", "--porcelain"])?;
    Ok(parse_worktree_list(&out))
}

/// Non-force only, by design: git refuses to remove a dirty or locked
/// worktree, and that refusal is the safety model. A clean removal loses
/// nothing — the branch and its commits survive.
#[tauri::command]
pub fn git_worktree_remove(cwd: String, path: String) -> Result<(), String> {
    let os = std::ffi::OsStr::new;
    run_git(Path::new(&cwd), [os("worktree"), os("remove"), os(&path)]).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn make_temp() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("logan-git-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_head(git_dir: &Path, contents: &str) {
        fs::create_dir_all(git_dir).unwrap();
        fs::write(git_dir.join("HEAD"), contents).unwrap();
    }

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

    // -- Worktree flows ----------------------------------------------------

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

    /// Temp repo with one commit so HEAD is born and worktrees can be added.
    fn init_repo(container: &Path) -> PathBuf {
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

    #[test]
    fn worktree_add_list_remove_roundtrip() {
        let container = make_temp().canonicalize().unwrap();
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
        assert!(
            git_worktree_remove(repo.to_string_lossy().into_owned(), created.path.clone()).is_err()
        );
        // ...and succeed once clean.
        fs::remove_file(expected.join("scratch.txt")).unwrap();
        git_worktree_remove(repo.to_string_lossy().into_owned(), created.path.clone()).unwrap();
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
}

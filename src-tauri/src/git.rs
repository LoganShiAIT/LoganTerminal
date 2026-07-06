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

// ---------------------------------------------------------------------------
// Worktree flows (Phase 11). Unlike the read-only branch lookup above, these
// shell out to real git — its error messages ("already exists", "contains
// modified or untracked files", "not a git repository") are the user-facing
// errors, verbatim.

fn run_git_raw<I, S>(dir: &Path, args: I) -> Result<std::process::Output, String>
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

fn run_git<I, S>(dir: &Path, args: I) -> Result<String, String>
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

// ---------------------------------------------------------------------------
// Dirty state + diff review + merge (Phase 12). `core.quotepath=false` on
// every path-emitting call so non-ASCII paths (中文 filenames) come out as
// raw UTF-8 instead of octal escapes.

const QUOTEPATH: [&str; 2] = ["-c", "core.quotepath=false"];

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

/// Branch + dirty counts in one round trip — refreshed on every OSC 7 prompt
/// event. `None` = not a repository (same contract as `git_branch` had). The
/// cheap `.git/HEAD` read gates the subprocess: no repo, no fork.
#[tauri::command]
pub fn git_status(cwd: String) -> Option<GitStatusInfo> {
    let dir = Path::new(&cwd);
    let branch = branch_for(dir)?;
    let dirty = run_git(dir, [QUOTEPATH[0], QUOTEPATH[1], "status", "--porcelain"])
        .ok()
        .map(|out| parse_status_porcelain(&out));
    Some(GitStatusInfo { branch, dirty })
}

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct DiffFile {
    pub path: String,
    /// None with `deletions` None = binary file (numstat prints `-\t-`).
    pub additions: Option<u32>,
    pub deletions: Option<u32>,
    pub untracked: bool,
}

#[derive(serde::Serialize, Debug)]
pub struct DiffSummary {
    pub files: Vec<DiffFile>,
    /// Branch mode: the base branch the range diffs against. Working: None.
    pub base: Option<String>,
}

/// With quotepath off, only paths holding control chars/quotes/backslashes
/// stay C-quoted; strip the wrap so they at least display sanely.
fn unquote_path(p: &str) -> String {
    let t = p.trim();
    if t.len() >= 2 && t.starts_with('"') && t.ends_with('"') {
        t[1..t.len() - 1].to_string()
    } else {
        t.to_string()
    }
}

/// Parse `git diff --numstat` lines: `additions\tdeletions\tpath`, with `-`
/// in both count columns for binary files.
pub fn parse_numstat(s: &str) -> Vec<DiffFile> {
    s.lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, '\t');
            let a = parts.next()?.trim();
            let d = parts.next()?.trim();
            let path = parts.next()?;
            if path.is_empty() {
                return None;
            }
            Some(DiffFile {
                path: unquote_path(path),
                additions: a.parse::<u32>().ok(),
                deletions: d.parse::<u32>().ok(),
                untracked: false,
            })
        })
        .collect()
}

fn main_worktree(cwd: &Path) -> Result<WorktreeEntry, String> {
    let out = run_git(cwd, ["worktree", "list", "--porcelain"])?;
    parse_worktree_list(&out)
        .into_iter()
        .find(|e| e.is_main)
        .ok_or_else(|| "cannot locate the main worktree".to_string())
}

fn base_branch(cwd: &Path) -> Result<String, String> {
    main_worktree(cwd)?
        .branch
        .ok_or_else(|| "main worktree is on a detached HEAD".to_string())
}

/// `--no-renames` keeps the numstat parser trivial (a rename is a delete +
/// an add); `--no-ext-diff` shields the output from any diff.external the
/// user configured.
const DIFF_OPTS: [&str; 2] = ["--no-renames", "--no-ext-diff"];

pub fn diff_summary_impl(cwd: &Path, mode: &str) -> Result<DiffSummary, String> {
    let qp = QUOTEPATH;
    match mode {
        "working" => {
            // Everything uncommitted (staged + unstaged) vs HEAD. Unborn
            // HEAD (fresh repo): fall back to index-vs-worktree — new files
            // there are untracked and covered by the ls-files pass anyway.
            let numstat = run_git(
                cwd,
                [
                    qp[0],
                    qp[1],
                    "diff",
                    "HEAD",
                    "--numstat",
                    DIFF_OPTS[0],
                    DIFF_OPTS[1],
                ],
            )
            .or_else(|_| {
                run_git(
                    cwd,
                    [
                        qp[0],
                        qp[1],
                        "diff",
                        "--numstat",
                        DIFF_OPTS[0],
                        DIFF_OPTS[1],
                    ],
                )
            })?;
            let mut files = parse_numstat(&numstat);
            let untracked = run_git(
                cwd,
                [qp[0], qp[1], "ls-files", "--others", "--exclude-standard"],
            )?;
            files.extend(
                untracked
                    .lines()
                    .filter(|l| !l.is_empty())
                    .map(|l| DiffFile {
                        path: unquote_path(l),
                        additions: None,
                        deletions: None,
                        untracked: true,
                    }),
            );
            Ok(DiffSummary { files, base: None })
        }
        "branch" => {
            // What this branch adds over the base: merge-base three-dot
            // range, so the base moving on doesn't pollute the view.
            let base = base_branch(cwd)?;
            let range = format!("{base}...HEAD");
            let numstat = run_git(
                cwd,
                [
                    qp[0],
                    qp[1],
                    "diff",
                    range.as_str(),
                    "--numstat",
                    DIFF_OPTS[0],
                    DIFF_OPTS[1],
                ],
            )?;
            Ok(DiffSummary {
                files: parse_numstat(&numstat),
                base: Some(base),
            })
        }
        _ => Err(format!("unknown diff mode: {mode}")),
    }
}

pub fn diff_file_impl(
    cwd: &Path,
    mode: &str,
    path: &str,
    untracked: bool,
) -> Result<String, String> {
    let qp = QUOTEPATH;
    if untracked {
        // `--no-index` exits 1 when the files differ — that's success here.
        // git special-cases the literal `/dev/null` on every platform.
        let out = run_git_raw(
            cwd,
            [
                qp[0],
                qp[1],
                "diff",
                DIFF_OPTS[1],
                "--no-index",
                "--",
                "/dev/null",
                path,
            ],
        )?;
        return match out.status.code() {
            Some(0) | Some(1) => Ok(String::from_utf8_lossy(&out.stdout).trim_end().to_string()),
            _ => Err(String::from_utf8_lossy(&out.stderr).trim().to_string()),
        };
    }
    match mode {
        "working" => run_git(
            cwd,
            [
                qp[0],
                qp[1],
                "diff",
                "HEAD",
                DIFF_OPTS[0],
                DIFF_OPTS[1],
                "--",
                path,
            ],
        )
        .or_else(|_| {
            // Same unborn-HEAD fallback as the summary.
            run_git(
                cwd,
                [qp[0], qp[1], "diff", DIFF_OPTS[0], DIFF_OPTS[1], "--", path],
            )
        }),
        "branch" => {
            let base = base_branch(cwd)?;
            let range = format!("{base}...HEAD");
            run_git(
                cwd,
                [
                    qp[0],
                    qp[1],
                    "diff",
                    range.as_str(),
                    DIFF_OPTS[0],
                    DIFF_OPTS[1],
                    "--",
                    path,
                ],
            )
        }
        _ => Err(format!("unknown diff mode: {mode}")),
    }
}

#[tauri::command]
pub fn git_diff_summary(cwd: String, mode: String) -> Result<DiffSummary, String> {
    diff_summary_impl(Path::new(&cwd), &mode)
}

#[tauri::command]
pub fn git_diff_file(
    cwd: String,
    mode: String,
    path: String,
    untracked: bool,
) -> Result<String, String> {
    diff_file_impl(Path::new(&cwd), &mode, &path, untracked)
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

#[tauri::command]
pub fn git_worktree_merge(cwd: String, path: String, branch: String) -> Result<String, String> {
    worktree_merge_impl(Path::new(&cwd), &path, &branch)
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

    // -- Dirty state + diff + merge (Phase 12) ------------------------------

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
    fn numstat_parses_counts_binaries_and_quoted_paths() {
        let files = parse_numstat("3\t1\tsrc/a.rs\n-\t-\timg.png\n5\t0\t\"we\\tird.txt\"\n");
        assert_eq!(files.len(), 3);
        assert_eq!(files[0].path, "src/a.rs");
        assert_eq!(files[0].additions, Some(3));
        assert_eq!(files[0].deletions, Some(1));
        // Binary: `-` in both columns → None/None.
        assert_eq!(files[1].additions, None);
        assert_eq!(files[1].deletions, None);
        // C-quoted path: at least the wrapping quotes come off.
        assert_eq!(files[2].path, "we\\tird.txt");
        assert!(parse_numstat("").is_empty());
    }

    /// `git commit` in these tests with inline identity, matching init_repo.
    fn commit_all(repo: &Path, msg: &str) {
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

    #[test]
    fn git_status_reports_branch_and_dirty_counts() {
        let container = make_temp().canonicalize().unwrap();
        let repo = init_repo(&container);
        let cwd = repo.to_string_lossy().into_owned();

        let clean = git_status(cwd.clone()).unwrap();
        assert_eq!(clean.branch, "main");
        assert_eq!(clean.dirty, Some(DirtyCounts::default()));

        fs::write(repo.join("a.txt"), "one\n").unwrap();
        commit_all(&repo, "add a");
        fs::write(repo.join("a.txt"), "one\ntwo\n").unwrap(); // modified
        fs::write(repo.join("b.txt"), "new\n").unwrap(); // untracked
        let dirty = git_status(cwd).unwrap().dirty.unwrap();
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
        assert!(git_status(plain.to_string_lossy().into_owned()).is_none());

        fs::remove_dir_all(&container).unwrap();
        fs::remove_dir_all(&plain).unwrap();
    }

    #[test]
    fn diff_summary_and_file_working_mode() {
        let container = make_temp().canonicalize().unwrap();
        let repo = init_repo(&container);

        fs::write(repo.join("a.txt"), "one\ntwo\n").unwrap();
        commit_all(&repo, "base");
        fs::write(repo.join("a.txt"), "one\ntwo\nthree\n").unwrap();
        fs::write(repo.join("b.txt"), "hello\n").unwrap();

        let sum = diff_summary_impl(&repo, "working").unwrap();
        assert_eq!(sum.base, None);
        assert_eq!(sum.files.len(), 2);
        let a = sum.files.iter().find(|f| f.path == "a.txt").unwrap();
        assert_eq!(
            (a.additions, a.deletions, a.untracked),
            (Some(1), Some(0), false)
        );
        let b = sum.files.iter().find(|f| f.path == "b.txt").unwrap();
        assert!(b.untracked);

        let patch = diff_file_impl(&repo, "working", "a.txt", false).unwrap();
        assert!(patch.contains("+three"));
        let untracked_patch = diff_file_impl(&repo, "working", "b.txt", true).unwrap();
        assert!(untracked_patch.contains("+hello"));

        fs::remove_dir_all(&container).unwrap();
    }

    #[test]
    fn diff_summary_working_survives_unborn_head() {
        let container = make_temp().canonicalize().unwrap();
        let repo = container.join("fresh");
        fs::create_dir_all(&repo).unwrap();
        run_git(&repo, ["init", "-b", "main"]).unwrap();
        fs::write(repo.join("x.txt"), "x\n").unwrap();

        // No commits yet: `diff HEAD` would fail; the fallback still lists
        // the new file via the untracked pass.
        let sum = diff_summary_impl(&repo, "working").unwrap();
        assert_eq!(sum.files.len(), 1);
        assert!(sum.files[0].untracked);
        assert_eq!(sum.files[0].path, "x.txt");

        fs::remove_dir_all(&container).unwrap();
    }

    #[test]
    fn diff_branch_mode_diffs_against_main_worktree_branch() {
        let container = make_temp().canonicalize().unwrap();
        let repo = init_repo(&container);
        fs::write(repo.join("base.txt"), "base\n").unwrap();
        commit_all(&repo, "base file");

        let created = worktree_add_impl(&repo, "feat").unwrap();
        let wt = PathBuf::from(&created.path);
        fs::write(wt.join("feat.txt"), "feature work\n").unwrap();
        commit_all(&wt, "feature commit");

        let sum = diff_summary_impl(&wt, "branch").unwrap();
        assert_eq!(sum.base.as_deref(), Some("main"));
        assert_eq!(sum.files.len(), 1);
        assert_eq!(sum.files[0].path, "feat.txt");

        let patch = diff_file_impl(&wt, "branch", "feat.txt", false).unwrap();
        assert!(patch.contains("+feature work"));

        // From the main worktree the same range is empty — nothing ahead.
        let main_sum = diff_summary_impl(&repo, "branch").unwrap();
        assert!(main_sum.files.is_empty());

        fs::remove_dir_all(&container).unwrap();
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

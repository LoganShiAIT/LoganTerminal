//! "What is different" — the two review modes the diff panel offers:
//! `working` (everything uncommitted) and `branch` (what this branch adds
//! over the main worktree's).
//!
//! Every path in a [`DiffSummary`] is relative to its `root`, and every
//! per-file call runs from there — see [`repo_root`] for why that is not
//! optional.

use super::repo::{quotepath_args, repo_root, run_git, run_git_raw, unquote_path};
use super::worktree::base_branch;
use std::path::Path;

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
    /// Worktree root every `path` in `files` is relative to — join the two to
    /// get something the rest of the app can open.
    pub root: String,
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

/// One `git diff` invocation's arguments. Building them in one place means no
/// call site can forget the flags they all need: quotepath off (see
/// [`quotepath_args`]), `--no-renames` so the numstat parser stays trivial (a
/// rename is a delete + an add), and `--no-ext-diff` so a user's
/// `diff.external` can't reshape the output.
///
/// `rev` is the revision or range to diff against (None = index vs worktree),
/// `path` limits the diff to one file.
fn diff_args<'a>(rev: Option<&'a str>, numstat: bool, path: Option<&'a str>) -> Vec<&'a str> {
    let mut args = quotepath_args(["diff"]);
    args.extend(rev);
    if numstat {
        args.push("--numstat");
    }
    args.extend(["--no-renames", "--no-ext-diff"]);
    if let Some(path) = path {
        args.extend(["--", path]);
    }
    args
}

pub fn diff_summary_impl(cwd: &Path, mode: &str) -> Result<DiffSummary, String> {
    let root = repo_root(cwd)?;
    let root_string = root.to_string_lossy().into_owned();
    match mode {
        "working" => {
            // Everything uncommitted (staged + unstaged) vs HEAD. Unborn
            // HEAD (fresh repo): fall back to index-vs-worktree — new files
            // there are untracked and covered by the ls-files pass anyway.
            let numstat = run_git(&root, diff_args(Some("HEAD"), true, None))
                .or_else(|_| run_git(&root, diff_args(None, true, None)))?;
            let mut files = parse_numstat(&numstat);
            // `--full-name`: ls-files is the one command here that would print
            // cwd-relative paths, which would sort untracked files into the
            // wrong folder and break the join with `root`.
            let untracked = run_git(
                &root,
                quotepath_args(["ls-files", "--others", "--exclude-standard", "--full-name"]),
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
            Ok(DiffSummary {
                files,
                base: None,
                root: root_string,
            })
        }
        "branch" => {
            // What this branch adds over the base: merge-base three-dot
            // range, so the base moving on doesn't pollute the view.
            let base = base_branch(cwd)?;
            let range = format!("{base}...HEAD");
            let numstat = run_git(&root, diff_args(Some(&range), true, None))?;
            Ok(DiffSummary {
                files: parse_numstat(&numstat),
                base: Some(base),
                root: root_string,
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
    // `path` came out of a summary, so it is root-relative — see [`repo_root`].
    let cwd = &repo_root(cwd)?;
    if untracked {
        // `--no-index` exits 1 when the files differ — that's success here.
        // git special-cases the literal `/dev/null` on every platform. Not
        // diff_args(): this compares two explicit paths, so there is no
        // revision and no rename detection to suppress.
        let out = run_git_raw(
            cwd,
            quotepath_args([
                "diff",
                "--no-ext-diff",
                "--no-index",
                "--",
                "/dev/null",
                path,
            ]),
        )?;
        return match out.status.code() {
            Some(0) | Some(1) => Ok(String::from_utf8_lossy(&out.stdout).trim_end().to_string()),
            _ => Err(String::from_utf8_lossy(&out.stderr).trim().to_string()),
        };
    }
    match mode {
        // Same unborn-HEAD fallback as the summary.
        "working" => run_git(cwd, diff_args(Some("HEAD"), false, Some(path)))
            .or_else(|_| run_git(cwd, diff_args(None, false, Some(path)))),
        "branch" => {
            let base = base_branch(cwd)?;
            let range = format!("{base}...HEAD");
            run_git(cwd, diff_args(Some(&range), false, Some(path)))
        }
        _ => Err(format!("unknown diff mode: {mode}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::log::{commit_file_impl, commit_summary_impl, log_impl};
    use crate::git::repo::tidy;
    use crate::git::testutil::{commit_all, init_repo, make_temp};
    use crate::git::worktree::worktree_add_impl;
    use std::fs;
    use std::path::PathBuf;

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
    fn diff_paths_stay_root_relative_from_a_subdirectory() {
        // Regression: `git diff --numstat` prints root-relative paths while
        // `ls-files --others` prints cwd-relative ones, so a shell sitting in
        // a subdirectory used to mix the two — untracked files landed in the
        // wrong folder of the tree, and no path could be joined with a root.
        let container = make_temp().canonicalize().unwrap();
        let repo = init_repo(&container);
        let nested = repo.join("src").join("lib");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("tracked.txt"), "one\n").unwrap();
        commit_all(&repo, "nested file");
        fs::write(nested.join("tracked.txt"), "one\ntwo\n").unwrap();
        fs::write(nested.join("fresh.txt"), "new\n").unwrap();

        let sum = diff_summary_impl(&nested, "working").unwrap();
        assert_eq!(PathBuf::from(&sum.root), tidy(repo.canonicalize().unwrap()));
        let mut paths: Vec<&str> = sum.files.iter().map(|f| f.path.as_str()).collect();
        paths.sort();
        assert_eq!(paths, ["src/lib/fresh.txt", "src/lib/tracked.txt"]);

        // Those same paths must still resolve when handed back to git.
        let patch = diff_file_impl(&nested, "working", "src/lib/tracked.txt", false).unwrap();
        assert!(patch.contains("+two"), "got: {patch}");
        let fresh = diff_file_impl(&nested, "working", "src/lib/fresh.txt", true).unwrap();
        assert!(fresh.contains("+new"), "got: {fresh}");

        // And so must a commit's own file list, read from the subdirectory.
        let head = log_impl(&nested, 1).unwrap().commits[0].hash.clone();
        let commit = commit_summary_impl(&nested, &head).unwrap();
        assert_eq!(commit.files[0].path, "src/lib/tracked.txt");
        assert!(commit_file_impl(&nested, &head, "src/lib/tracked.txt")
            .unwrap()
            .contains("+one"));

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
}

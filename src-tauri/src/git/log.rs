//! "How did it get there" — commit history and per-commit diffs.
//!
//! The diff module answers what is different right now; this one supplies the
//! commit graph the panel draws lanes from, plus the file list and patch for
//! any single commit in it.

use super::diff::{parse_numstat, DiffSummary};
use super::repo::{find_git_dir, quotepath_args, repo_root, run_git};
use super::worktree::base_branch;
use std::path::Path;

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct Commit {
    pub hash: String,
    pub short: String,
    /// Full hashes, first parent first — the lane layout depends on the order.
    pub parents: Vec<String>,
    pub author: String,
    /// Author date, unix seconds.
    pub timestamp: i64,
    /// Decorations git prints for this commit: `HEAD -> main`, `tag: v1`, …
    pub refs: Vec<String>,
    pub subject: String,
    /// Reachable from HEAD but not from the base branch — this branch's own
    /// work, as opposed to history it merely inherited.
    pub ahead: bool,
}

#[derive(serde::Serialize, Debug)]
pub struct CommitLog {
    pub commits: Vec<Commit>,
    /// The main worktree's branch, when there is one to compare against.
    pub base: Option<String>,
}

/// One `git log` record. Unit-separated (`%x1f`) so subjects, author names and
/// ref decorations can hold commas and spaces without confusing the parser;
/// `%s` is the subject's first line only, so one record still means one line.
const LOG_FORMAT: &str = "%H%x1f%h%x1f%P%x1f%an%x1f%at%x1f%D%x1f%s";

/// Parse the [`LOG_FORMAT`] records. Malformed lines are dropped rather than
/// failing the whole log — a partial history beats an error page.
pub fn parse_log(s: &str) -> Vec<Commit> {
    s.lines()
        .filter_map(|line| {
            let mut f = line.splitn(7, '\u{1f}');
            let hash = f.next()?.trim().to_string();
            let short = f.next()?.to_string();
            let parents = f.next()?.split_whitespace().map(str::to_string).collect();
            let author = f.next()?.to_string();
            let timestamp = f.next()?.trim().parse::<i64>().unwrap_or(0);
            let refs = f
                .next()?
                .split(", ")
                .map(str::trim)
                .filter(|r| !r.is_empty())
                .map(str::to_string)
                .collect();
            let subject = f.next().unwrap_or("").to_string();
            if hash.is_empty() {
                return None;
            }
            Some(Commit {
                hash,
                short,
                parents,
                author,
                timestamp,
                refs,
                subject,
                ahead: false,
            })
        })
        .collect()
}

/// A revision this module is willing to hand to git as a bare argument.
/// Everything the panel sends comes out of [`parse_log`], so this only has to
/// rule out the leading-`-` "looks like a flag" class of surprises.
fn valid_hash(h: &str) -> bool {
    (4..=64).contains(&h.len()) && h.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Recent history, newest first. Both HEAD and the base branch tip go in as
/// start points, so a worktree branch shows its fork instead of a bare line.
pub fn log_impl(cwd: &Path, limit: u32) -> Result<CommitLog, String> {
    let base = base_branch(cwd).ok();
    let count = limit.clamp(1, 400);
    let head_only: Vec<String> = vec![
        "log".into(),
        "--date-order".into(),
        format!("--max-count={count}"),
        format!("--pretty=format:{LOG_FORMAT}"),
        "HEAD".into(),
    ];
    let mut args = head_only.clone();
    if let Some(b) = &base {
        args.push(b.clone());
    }
    let text = match run_git(cwd, args) {
        Ok(t) => t,
        // The base ref may not resolve from here (deleted, or renamed since);
        // HEAD alone still logs.
        Err(e) => match run_git(cwd, head_only) {
            Ok(t) => t,
            // Fresh repo with no commits: an empty history, not an error.
            Err(_)
                if find_git_dir(cwd).is_some()
                    && run_git(cwd, ["rev-parse", "--verify", "HEAD"]).is_err() =>
            {
                return Ok(CommitLog {
                    commits: Vec::new(),
                    base,
                })
            }
            Err(_) => return Err(e),
        },
    };

    let mut commits = parse_log(&text);
    if let Some(b) = &base {
        let range = [
            "rev-list".to_string(),
            format!("--max-count={count}"),
            format!("{b}..HEAD"),
        ];
        if let Ok(list) = run_git(cwd, range) {
            let ahead: std::collections::HashSet<&str> = list
                .lines()
                .map(str::trim)
                .filter(|l| !l.is_empty())
                .collect();
            for c in &mut commits {
                c.ahead = ahead.contains(c.hash.as_str());
            }
        }
    }
    Ok(CommitLog { commits, base })
}

/// Files one commit touched. `--format=` drops the commit header so the output
/// is pure numstat; merge commits legitimately produce nothing here.
pub fn commit_summary_impl(cwd: &Path, hash: &str) -> Result<DiffSummary, String> {
    if !valid_hash(hash) {
        return Err(format!("not a commit hash: {hash}"));
    }
    let root = repo_root(cwd)?;
    let mut args = quotepath_args([
        "show",
        "--numstat",
        "--no-renames",
        "--no-ext-diff",
        "--format=",
    ]);
    args.push(hash);
    let out = run_git(&root, args)?;
    Ok(DiffSummary {
        files: parse_numstat(&out),
        base: None,
        root: root.to_string_lossy().into_owned(),
    })
}

pub fn commit_file_impl(cwd: &Path, hash: &str, path: &str) -> Result<String, String> {
    if !valid_hash(hash) {
        return Err(format!("not a commit hash: {hash}"));
    }
    // Root-relative `path` again — the pathspec has to resolve from the root.
    let root = repo_root(cwd)?;
    let mut args = quotepath_args(["show", "--no-renames", "--no-ext-diff", "--format="]);
    args.push(hash);
    args.extend(["--", path]);
    run_git(&root, args)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::testutil::{commit_all, init_repo, make_temp};
    use crate::git::worktree::worktree_add_impl;
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn parse_log_reads_records_and_tolerates_junk() {
        let s = concat!(
            "abc123\u{1f}abc123\u{1f}def456 999aaa\u{1f}Ada\u{1f}1700000000\u{1f}",
            "HEAD -> feat, tag: v1\u{1f}subject, with a comma\n",
            "def456\u{1f}def456\u{1f}\u{1f}Grace\u{1f}1699999999\u{1f}\u{1f}root commit\n",
            "not a record\n",
        );
        let commits = parse_log(s);
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].parents, vec!["def456", "999aaa"]);
        assert_eq!(commits[0].author, "Ada");
        assert_eq!(commits[0].timestamp, 1_700_000_000);
        assert_eq!(commits[0].refs, vec!["HEAD -> feat", "tag: v1"]);
        // The subject keeps its comma; only the ref list splits on ", ".
        assert_eq!(commits[0].subject, "subject, with a comma");
        // Root commit: no parents, no decorations.
        assert!(commits[1].parents.is_empty());
        assert!(commits[1].refs.is_empty());
        assert!(parse_log("").is_empty());
    }

    #[test]
    fn valid_hash_rejects_flags_and_junk() {
        assert!(valid_hash("abc123"));
        assert!(valid_hash("0123456789abcdef0123456789abcdef01234567"));
        assert!(!valid_hash("--all"));
        assert!(!valid_hash("HEAD"));
        assert!(!valid_hash("abc"));
        assert!(!valid_hash(""));
    }

    #[test]
    fn log_marks_branch_commits_ahead_and_reads_commit_diffs() {
        let container = make_temp().canonicalize().unwrap();
        let repo = init_repo(&container);
        fs::write(repo.join("base.txt"), "base\n").unwrap();
        commit_all(&repo, "base file");

        let created = worktree_add_impl(&repo, "feat").unwrap();
        let wt = PathBuf::from(&created.path);
        fs::write(wt.join("feat.txt"), "feature work\n").unwrap();
        commit_all(&wt, "feature commit");

        let log = log_impl(&wt, 50).unwrap();
        assert_eq!(log.base.as_deref(), Some("main"));
        // Newest first, and the shared history came along with the base tip.
        assert_eq!(log.commits[0].subject, "feature commit");
        assert!(log.commits[0].ahead);
        assert_eq!(log.commits[1].subject, "base file");
        assert!(!log.commits[1].ahead, "base history is not ahead");
        assert_eq!(log.commits[0].parents, vec![log.commits[1].hash.clone()]);
        assert!(log.commits[0].refs.iter().any(|r| r.contains("feat")));

        // Nothing is ahead when HEAD *is* the base branch.
        let main_log = log_impl(&repo, 50).unwrap();
        assert!(main_log.commits.iter().all(|c| !c.ahead));

        let hash = log.commits[0].hash.clone();
        let sum = commit_summary_impl(&wt, &hash).unwrap();
        assert_eq!(sum.files.len(), 1);
        assert_eq!(sum.files[0].path, "feat.txt");
        assert_eq!(sum.files[0].additions, Some(1));
        let patch = commit_file_impl(&wt, &hash, "feat.txt").unwrap();
        assert!(patch.contains("+feature work"));
        assert!(commit_summary_impl(&wt, "--all").is_err());

        fs::remove_dir_all(&container).unwrap();
    }

    #[test]
    fn log_on_a_fresh_repo_is_empty_not_an_error() {
        let container = make_temp().canonicalize().unwrap();
        let repo = container.join("fresh");
        fs::create_dir_all(&repo).unwrap();
        run_git(&repo, ["init", "-b", "main"]).unwrap();

        assert!(log_impl(&repo, 50).unwrap().commits.is_empty());
        // Outside a repository it is still an error.
        let plain = make_temp();
        assert!(log_impl(&plain, 50).is_err());

        fs::remove_dir_all(&container).unwrap();
        fs::remove_dir_all(&plain).unwrap();
    }
}

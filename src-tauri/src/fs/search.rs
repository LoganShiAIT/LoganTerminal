//! Fuzzy file/folder search behind ⌘⇧F.
//!
//! Deliberately stateless: every keystroke re-walks instead of maintaining a
//! cached index, so results can never be stale (a file created a second ago
//! shows up) and there is no invalidation logic to get wrong. The scan bounds
//! below are what make that affordable — a stray search at `/` must not hang
//! the UI.

use serde::Serialize;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};

const SEARCH_MAX_DEPTH: usize = 12;
const SEARCH_MAX_SCAN: usize = 20_000;
pub const SEARCH_DEFAULT_LIMIT: usize = 120;
pub const SEARCH_MAX_LIMIT: usize = 500;

/// Directories that are noise when locating source files and would otherwise
/// eat the whole scan budget. Same spirit as ripgrep's default ignores.
const SEARCH_SKIP_DIRS: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".turbo",
    ".cache",
    ".venv",
    "venv",
    "__pycache__",
    ".gradle",
    ".idea",
    "DerivedData",
    "Pods",
    "vendor",
];

#[derive(Serialize, Debug)]
pub struct SearchHit {
    /// Absolute path — what the frontend inserts / reveals.
    pub path: String,
    /// Path relative to the search root; also the string that was matched.
    pub rel: String,
    pub name: String,
    pub is_dir: bool,
    /// Directory that directly contains a `.git` entry (a project root).
    pub is_repo: bool,
    pub score: f64,
    /// Char indices into `rel` that matched, for highlighting.
    pub indices: Vec<usize>,
}

#[derive(Serialize, Debug)]
pub struct SearchOutcome {
    pub hits: Vec<SearchHit>,
    /// Entries visited by the walk (post filtering of skipped dirs).
    pub scanned: usize,
    /// Matches found before `limit` was applied.
    pub total: usize,
    /// True when the scan budget ran out — results are partial.
    pub truncated: bool,
}

#[derive(Clone, Copy, PartialEq)]
pub enum SearchKind {
    All,
    Dirs,
    Files,
}

impl SearchKind {
    pub fn parse(raw: Option<&str>) -> Self {
        match raw {
            Some("dir") | Some("dirs") => SearchKind::Dirs,
            Some("file") | Some("files") => SearchKind::Files,
            _ => SearchKind::All,
        }
    }

    fn accepts(self, is_dir: bool) -> bool {
        match self {
            SearchKind::All => true,
            SearchKind::Dirs => is_dir,
            SearchKind::Files => !is_dir,
        }
    }
}

pub struct SearchOpts {
    pub kind: SearchKind,
    pub show_hidden: bool,
    pub limit: usize,
    pub max_depth: usize,
    pub max_scan: usize,
}

impl SearchOpts {
    /// The bounds every real query runs under; tests override them directly.
    pub fn new(kind: SearchKind, show_hidden: bool, limit: usize) -> Self {
        Self {
            kind,
            show_hidden,
            limit: limit.min(SEARCH_MAX_LIMIT),
            max_depth: SEARCH_MAX_DEPTH,
            max_scan: SEARCH_MAX_SCAN,
        }
    }
}

fn lower(c: char) -> char {
    c.to_lowercase().next().unwrap_or(c)
}

fn is_boundary(c: char) -> bool {
    c.is_whitespace() || matches!(c, '-' | '_' | '/' | '\\' | '.' | ':' | '@')
}

/// Subsequence fuzzy match, mirroring `src/lib/fuzzy.ts`: every query char must
/// appear in order, word-starts and consecutive runs score higher. The extra
/// twist here is `name_start` — matches inside the file name itself beat
/// matches that only landed somewhere in the parent directories.
fn fuzzy_score(query: &[char], target: &[char], name_start: usize) -> Option<(f64, Vec<usize>)> {
    if query.is_empty() {
        return Some((0.0, Vec::new()));
    }
    let mut indices: Vec<usize> = Vec::with_capacity(query.len());
    let mut score = 0.0f64;
    let mut from = 0usize;

    for &qc in query {
        let found = (from..target.len()).find(|&i| target[i] == qc)?;
        if found == 0 || is_boundary(target[found - 1]) {
            score += 10.0;
        } else if indices.last().is_some_and(|&prev| found == prev + 1) {
            score += 8.0;
        } else {
            score += 1.0;
        }
        if found >= name_start {
            score += 3.0;
        }
        indices.push(found);
        from = found + 1;
    }

    score -= indices[0] as f64 * 0.1 + target.len() as f64 * 0.02;
    Some((score, indices))
}

pub fn search_dir(root: &Path, query: &str, opts: &SearchOpts) -> std::io::Result<SearchOutcome> {
    if !root.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "search root is not a directory",
        ));
    }

    let q: Vec<char> = query
        .chars()
        .filter(|c| !c.is_whitespace())
        .map(lower)
        .collect();

    let mut hits: Vec<SearchHit> = Vec::new();
    let mut scanned = 0usize;
    let mut truncated = false;

    // Breadth-first so shallow matches are found (and, on a truncated scan,
    // kept) before deep ones. The last tuple slot is the entry's index in
    // `hits`, used to backfill `is_repo` once we read its children.
    let mut queue: VecDeque<(PathBuf, String, usize, Option<usize>)> = VecDeque::new();
    queue.push_back((root.to_path_buf(), String::new(), 0, None));

    'walk: while let Some((dir, rel_prefix, depth, self_index)) = queue.pop_front() {
        let Ok(read) = std::fs::read_dir(&dir) else {
            continue; // unreadable dir (permissions) — skip, never fail the search
        };
        let mut children: Vec<(String, bool)> = read
            .filter_map(|e| e.ok())
            .map(|e| {
                // file_type() does not follow symlinks, so symlinked dirs are
                // treated as plain entries — that is what keeps cycles out.
                let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
                (e.file_name().to_string_lossy().into_owned(), is_dir)
            })
            .collect();

        // Checked before the hidden filter — `.git` is itself a dotfile.
        if let Some(idx) = self_index {
            if children.iter().any(|(n, is_dir)| *is_dir && n == ".git") {
                hits[idx].is_repo = true;
            }
        }

        children.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));

        for (name, is_dir) in children {
            if !opts.show_hidden && name.starts_with('.') {
                continue;
            }
            if is_dir && SEARCH_SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            if scanned >= opts.max_scan {
                truncated = true;
                break 'walk;
            }
            scanned += 1;

            let rel = if rel_prefix.is_empty() {
                name.clone()
            } else {
                format!("{rel_prefix}/{name}")
            };
            let path = dir.join(&name);

            let mut index = None;
            if opts.kind.accepts(is_dir) {
                let target: Vec<char> = rel.chars().map(lower).collect();
                let name_start = target.len().saturating_sub(name.chars().count());
                if let Some((mut score, indices)) = fuzzy_score(&q, &target, name_start) {
                    // Shallower results win ties; with an empty query this is
                    // the only term, which keeps the plain breadth-first order.
                    score -= depth as f64 * 0.6;
                    index = Some(hits.len());
                    hits.push(SearchHit {
                        path: path.to_string_lossy().into_owned(),
                        rel,
                        name: name.clone(),
                        is_dir,
                        is_repo: false,
                        score,
                        indices,
                    });
                }
            }

            if is_dir && depth + 1 < opts.max_depth {
                let child_rel = if rel_prefix.is_empty() {
                    name
                } else {
                    format!("{rel_prefix}/{name}")
                };
                queue.push_back((path, child_rel, depth + 1, index));
            }
        }
    }

    // Stable sort: equal scores keep breadth-first order.
    hits.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let total = hits.len();
    hits.truncate(opts.limit);

    Ok(SearchOutcome {
        hits,
        scanned,
        total,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn make_search_fixture() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("logan-search-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(dir.join("src/components/FileTree")).unwrap();
        fs::create_dir_all(dir.join("node_modules/react")).unwrap();
        fs::create_dir_all(dir.join(".hidden")).unwrap();
        fs::create_dir_all(dir.join("repo/.git")).unwrap();
        fs::write(dir.join("src/components/FileTree/FileTree.tsx"), "x").unwrap();
        fs::write(dir.join("src/main.tsx"), "x").unwrap();
        fs::write(dir.join("node_modules/react/index.js"), "x").unwrap();
        fs::write(dir.join(".hidden/secret.txt"), "x").unwrap();
        fs::write(dir.join("repo/README.md"), "x").unwrap();
        dir
    }

    fn opts(kind: SearchKind, show_hidden: bool) -> SearchOpts {
        SearchOpts::new(kind, show_hidden, SEARCH_DEFAULT_LIMIT)
    }

    #[test]
    fn search_finds_nested_entries_and_ranks_name_matches_first() {
        let dir = make_search_fixture();
        let out = search_dir(&dir, "filetree", &opts(SearchKind::All, false)).unwrap();
        let rels: Vec<&str> = out.hits.iter().map(|h| h.rel.as_str()).collect();

        // The directory is shallower, the .tsx file matches inside its own
        // name — both must be found, with nothing else scoring.
        assert!(rels.contains(&"src/components/FileTree"), "{rels:?}");
        assert!(
            rels.contains(&"src/components/FileTree/FileTree.tsx"),
            "{rels:?}"
        );
        assert_eq!(out.total, 2, "{rels:?}");
        assert!(!out.truncated);
        assert!(out.hits.iter().all(|h| !h.indices.is_empty()));

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn search_skips_ignored_and_hidden_directories() {
        let dir = make_search_fixture();

        let out = search_dir(&dir, "react", &opts(SearchKind::All, false)).unwrap();
        assert!(out.hits.is_empty(), "node_modules must not be walked");

        let out = search_dir(&dir, "secret", &opts(SearchKind::All, false)).unwrap();
        assert!(out.hits.is_empty(), "dotdirs are hidden by default");

        let out = search_dir(&dir, "secret", &opts(SearchKind::All, true)).unwrap();
        assert_eq!(out.hits.len(), 1, "show_hidden reveals dotdir contents");
        assert_eq!(out.hits[0].rel, ".hidden/secret.txt");

        // .git is skipped even with hidden files on — it is always noise.
        let out = search_dir(&dir, "git", &opts(SearchKind::All, true)).unwrap();
        assert!(
            out.hits.iter().all(|h| !h.rel.contains(".git")),
            "{:?}",
            out.hits.iter().map(|h| &h.rel).collect::<Vec<_>>()
        );

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn search_kind_filter_and_repo_flag() {
        let dir = make_search_fixture();

        let dirs = search_dir(&dir, "repo", &opts(SearchKind::Dirs, false)).unwrap();
        assert_eq!(dirs.hits.len(), 1);
        assert!(dirs.hits[0].is_dir);
        assert!(dirs.hits[0].is_repo, "a dir holding .git is a project root");

        let files = search_dir(&dir, "readme", &opts(SearchKind::Files, false)).unwrap();
        assert_eq!(files.hits.len(), 1);
        assert!(!files.hits[0].is_dir);
        assert_eq!(files.hits[0].name, "README.md");

        let none = search_dir(&dir, "readme", &opts(SearchKind::Dirs, false)).unwrap();
        assert!(none.hits.is_empty());

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn empty_query_lists_shallow_entries_first() {
        let dir = make_search_fixture();
        let out = search_dir(&dir, "", &opts(SearchKind::All, false)).unwrap();
        let rels: Vec<&str> = out.hits.iter().map(|h| h.rel.as_str()).collect();

        assert_eq!(rels[0], "repo", "dirs before files at the shallowest depth");
        assert!(rels.contains(&"src"));
        let depth_of = |r: &str| r.matches('/').count();
        for pair in rels.windows(2) {
            assert!(
                depth_of(pair[0]) <= depth_of(pair[1]),
                "breadth-first order broken: {rels:?}"
            );
        }

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn search_stops_at_the_scan_budget() {
        let dir = make_search_fixture();
        let mut capped = opts(SearchKind::All, false);
        capped.max_scan = 2;

        let out = search_dir(&dir, "", &capped).unwrap();
        assert_eq!(out.scanned, 2);
        assert!(out.truncated, "hitting the budget must be reported");

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn search_limit_caps_hits_but_reports_the_real_total() {
        let dir = make_search_fixture();
        let mut one = opts(SearchKind::All, false);
        one.limit = 1;

        let out = search_dir(&dir, "", &one).unwrap();
        assert_eq!(out.hits.len(), 1);
        assert!(out.total > 1, "total counts matches before the cap");

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn search_root_must_be_a_directory() {
        let dir = make_search_fixture();
        let err = search_dir(&dir.join("src/main.tsx"), "", &opts(SearchKind::All, false))
            .unwrap_err()
            .to_string();
        assert!(err.contains("not a directory"), "{err}");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn fuzzy_score_prefers_word_starts_and_name_matches() {
        let score = |q: &str, rel: &str, name: &str| {
            let target: Vec<char> = rel.chars().map(lower).collect();
            let name_start = target.len() - name.chars().count();
            let query: Vec<char> = q.chars().map(lower).collect();
            fuzzy_score(&query, &target, name_start).map(|(s, _)| s)
        };

        assert!(score("ft", "no/match/here", "here").is_none());

        // Same query, same length: the one matching inside the file name wins.
        let in_name = score("ab", "x/ab.ts", "ab.ts").unwrap();
        let in_parent = score("ab", "ab/x.ts", "x.ts").unwrap();
        assert!(in_name > in_parent, "{in_name} vs {in_parent}");

        // Word starts beat mid-word hits.
        let boundary = score("fm", "src/file-mod.ts", "file-mod.ts").unwrap();
        let mid = score("fm", "src/xfixmore.ts", "xfixmore.ts").unwrap();
        assert!(boundary > mid, "{boundary} vs {mid}");

        // Case-insensitive, and an empty query matches everything at 0.
        assert!(score("FILE", "src/file.ts", "file.ts").is_some());
        assert_eq!(score("", "anything", "anything").unwrap(), 0.0);
    }
}

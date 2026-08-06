use serde::Serialize;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};

const MAX_TEXT_FILE_BYTES: u64 = 1024 * 1024;
/// Paste-as-file history cap — same lesson as the clipboard PNG store: any
/// file-backed history needs an eviction story or it grows forever.
const MAX_PASTE_FILES: usize = 50;

/// Search walk bounds. The walk is redone per query (no index to invalidate),
/// so it has to stay cheap and, above all, bounded — a stray search at `/`
/// must not hang the UI.
const SEARCH_MAX_DEPTH: usize = 12;
const SEARCH_MAX_SCAN: usize = 20_000;
const SEARCH_DEFAULT_LIMIT: usize = 120;
const SEARCH_MAX_LIMIT: usize = 500;

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

#[derive(Serialize)]
pub struct FsEntry {
    pub name: String,
    pub is_dir: bool,
}

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

#[derive(Serialize)]
pub struct FsPathInfo {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub size: u64,
}

fn list_dir_entries(path: &Path, show_hidden: bool) -> std::io::Result<Vec<FsEntry>> {
    let read = std::fs::read_dir(path)?;

    let mut entries: Vec<FsEntry> = read
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if !show_hidden && name.starts_with('.') {
                return None;
            }
            let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            Some(FsEntry { name, is_dir })
        })
        .collect();

    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.cmp(&b.name)));
    Ok(entries)
}

#[tauri::command]
pub fn fs_list_dir(path: String, show_hidden: Option<bool>) -> Result<Vec<FsEntry>, String> {
    list_dir_entries(Path::new(&path), show_hidden.unwrap_or(false)).map_err(|e| e.to_string())
}

#[derive(Clone, Copy, PartialEq)]
enum SearchKind {
    All,
    Dirs,
    Files,
}

impl SearchKind {
    fn parse(raw: Option<&str>) -> Self {
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

struct SearchOpts {
    kind: SearchKind,
    show_hidden: bool,
    limit: usize,
    max_depth: usize,
    max_scan: usize,
}

/// Recursive fuzzy search for files and folders under `root`.
///
/// Deliberately stateless: every keystroke re-walks instead of maintaining a
/// cached index, so results can never be stale (a file created a second ago
/// shows up) and there is no invalidation logic to get wrong. The scan bounds
/// above are what make that affordable.
#[tauri::command]
pub fn fs_search(
    root: String,
    query: String,
    kind: Option<String>,
    show_hidden: Option<bool>,
    limit: Option<usize>,
) -> Result<SearchOutcome, String> {
    let opts = SearchOpts {
        kind: SearchKind::parse(kind.as_deref()),
        show_hidden: show_hidden.unwrap_or(false),
        limit: limit.unwrap_or(SEARCH_DEFAULT_LIMIT).min(SEARCH_MAX_LIMIT),
        max_depth: SEARCH_MAX_DEPTH,
        max_scan: SEARCH_MAX_SCAN,
    };
    search_dir(Path::new(&root), &query, &opts).map_err(|e| e.to_string())
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

fn search_dir(root: &Path, query: &str, opts: &SearchOpts) -> std::io::Result<SearchOutcome> {
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

#[tauri::command]
pub fn fs_stat_path(path: String) -> Result<FsPathInfo, String> {
    stat_path(Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_read_text_file(path: String) -> Result<String, String> {
    read_text_file(Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_write_text_file(path: String, contents: String) -> Result<(), String> {
    write_text_file(Path::new(&path), &contents).map_err(|e| e.to_string())
}

/// Writes clipboard text to `~/.logan-terminal/pastes/paste-<stamp>.txt`
/// and returns the path, so huge multi-line text can be handed to an agent
/// as a file path instead of a wall-of-text paste. The frontend supplies
/// the (cosmetic, time-sortable) stamp; uniqueness comes from the collision
/// suffix, and the dir is pruned to the newest MAX_PASTE_FILES.
#[tauri::command]
pub fn paste_to_file(contents: String, stamp: String) -> Result<String, String> {
    let dir = pastes_dir().ok_or("no home directory")?;
    let safe: String = stamp
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .take(32)
        .collect();
    let safe = if safe.is_empty() {
        "paste".to_string()
    } else {
        safe
    };
    paste_into_dir(&dir, &contents, &safe, MAX_PASTE_FILES)
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| e.to_string())
}

fn pastes_dir() -> Option<PathBuf> {
    let home = fs_home_dir();
    if home.is_empty() {
        return None;
    }
    Some(PathBuf::from(home).join(".logan-terminal").join("pastes"))
}

fn paste_into_dir(
    dir: &Path,
    contents: &str,
    stamp: &str,
    keep: usize,
) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let mut path = dir.join(format!("paste-{stamp}.txt"));
    let mut n = 1;
    while path.exists() {
        path = dir.join(format!("paste-{stamp}-{n}.txt"));
        n += 1;
    }
    std::fs::write(&path, contents)?;
    prune_paste_dir(dir, keep)?;
    Ok(path)
}

/// Deletes the oldest files (by mtime) beyond `keep`.
fn prune_paste_dir(dir: &Path, keep: usize) -> std::io::Result<()> {
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = std::fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .collect();
    if files.len() <= keep {
        return Ok(());
    }
    files.sort_by_key(|f| std::cmp::Reverse(f.0)); // newest first
    for (_, path) in files.split_off(keep) {
        let _ = std::fs::remove_file(path);
    }
    Ok(())
}

#[tauri::command]
pub fn fs_home_dir() -> String {
    #[cfg(unix)]
    {
        std::env::var("HOME").unwrap_or_default()
    }
    #[cfg(windows)]
    {
        std::env::var("USERPROFILE").unwrap_or_default()
    }
}

fn stat_path(path: &Path) -> std::io::Result<FsPathInfo> {
    let metadata = std::fs::metadata(path)?;
    let kind = if metadata.is_dir() {
        "directory"
    } else if metadata.is_file() {
        "file"
    } else {
        "other"
    };
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_else(|| path.to_str().unwrap_or(""))
        .to_string();

    Ok(FsPathInfo {
        path: path.to_string_lossy().into_owned(),
        name,
        kind: kind.to_string(),
        size: metadata.len(),
    })
}

fn read_text_file(path: &Path) -> std::io::Result<String> {
    let metadata = std::fs::metadata(path)?;
    if !metadata.is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "path is not a file",
        ));
    }
    if metadata.len() > MAX_TEXT_FILE_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "file is larger than 1MB",
        ));
    }

    let bytes = std::fs::read(path)?;
    if bytes.contains(&0) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "file appears to be binary",
        ));
    }
    String::from_utf8(bytes).map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "file is not valid UTF-8 text",
        )
    })
}

fn write_text_file(path: &Path, contents: &str) -> std::io::Result<()> {
    let metadata = std::fs::metadata(path)?;
    if !metadata.is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "path is not a file",
        ));
    }
    std::fs::write(path, contents)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn make_fixture_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("logan-fs-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("b.txt"), "b").unwrap();
        fs::write(dir.join("a.txt"), "a").unwrap();
        fs::write(dir.join(".env"), "secret").unwrap();
        fs::create_dir(dir.join(".claude")).unwrap();
        dir
    }

    #[test]
    fn hidden_entries_are_filtered_by_default() {
        let dir = make_fixture_dir();
        let names: Vec<String> = list_dir_entries(&dir, false)
            .unwrap()
            .into_iter()
            .map(|e| e.name)
            .collect();
        assert_eq!(names, vec!["sub", "a.txt", "b.txt"]);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn show_hidden_includes_dotfiles_dirs_first_sorted() {
        let dir = make_fixture_dir();
        let entries = list_dir_entries(&dir, true).unwrap();
        let names: Vec<String> = entries.iter().map(|e| e.name.clone()).collect();
        assert_eq!(names, vec![".claude", "sub", ".env", "a.txt", "b.txt"]);
        assert!(entries[0].is_dir && entries[1].is_dir);
        assert!(!entries[2].is_dir);
        fs::remove_dir_all(dir).unwrap();
    }

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
        SearchOpts {
            kind,
            show_hidden,
            limit: SEARCH_DEFAULT_LIMIT,
            max_depth: SEARCH_MAX_DEPTH,
            max_scan: SEARCH_MAX_SCAN,
        }
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

    #[test]
    fn stat_path_reports_file_and_directory() {
        let dir = make_fixture_dir();
        let file = dir.join("a.txt");

        let dir_info = stat_path(&dir).unwrap();
        assert_eq!(dir_info.kind, "directory");

        let file_info = stat_path(&file).unwrap();
        assert_eq!(file_info.kind, "file");
        assert_eq!(file_info.name, "a.txt");
        assert_eq!(file_info.size, 1);

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn read_text_file_accepts_utf8_and_rejects_binary() {
        let dir = make_fixture_dir();
        let text = dir.join("note.txt");
        let binary = dir.join("bin.dat");
        fs::write(&text, "hello\nLogan").unwrap();
        fs::write(&binary, b"a\0b").unwrap();

        assert_eq!(read_text_file(&text).unwrap(), "hello\nLogan");
        assert!(read_text_file(&binary)
            .unwrap_err()
            .to_string()
            .contains("binary"));

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn read_text_file_rejects_large_files() {
        let dir = make_fixture_dir();
        let large = dir.join("large.txt");
        fs::write(&large, vec![b'a'; (MAX_TEXT_FILE_BYTES + 1) as usize]).unwrap();

        assert!(read_text_file(&large)
            .unwrap_err()
            .to_string()
            .contains("larger than 1MB"));

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn write_text_file_updates_existing_file() {
        let dir = make_fixture_dir();
        let file = dir.join("a.txt");

        write_text_file(&file, "changed").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "changed");

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn paste_into_dir_writes_creates_dir_and_suffixes_collisions() {
        let dir = std::env::temp_dir().join(format!("logan-paste-test-{}", uuid::Uuid::new_v4()));
        let pastes = dir.join("pastes"); // does not exist yet

        let a = paste_into_dir(&pastes, "first", "20260704-190000", 50).unwrap();
        let b = paste_into_dir(&pastes, "second", "20260704-190000", 50).unwrap();

        assert_eq!(fs::read_to_string(&a).unwrap(), "first");
        assert_eq!(fs::read_to_string(&b).unwrap(), "second");
        assert_ne!(a, b, "same-stamp pastes must not overwrite");
        assert!(b.to_string_lossy().contains("20260704-190000-1"));

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn paste_dir_prunes_oldest_beyond_cap() {
        let dir = std::env::temp_dir().join(format!("logan-paste-prune-{}", uuid::Uuid::new_v4()));

        // Sequential writes have strictly increasing mtimes (ns resolution
        // on APFS/ext4); keep=3 must evict the two oldest.
        for i in 0..5 {
            paste_into_dir(&dir, &format!("v{i}"), &format!("stamp-{i}"), 3).unwrap();
        }

        let mut names: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(
            names,
            vec![
                "paste-stamp-2.txt".to_string(),
                "paste-stamp-3.txt".to_string(),
                "paste-stamp-4.txt".to_string(),
            ],
            "oldest two should be pruned"
        );

        fs::remove_dir_all(dir).unwrap();
    }
}

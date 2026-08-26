use std::collections::{HashMap, HashSet};
use std::thread;
use std::time::Duration;

use parking_lot::Mutex;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
use tauri::{AppHandle, Emitter, Manager};

use crate::pty::PtyManager;

const POLL_INTERVAL: Duration = Duration::from_millis(2000);

/// Names we recognize as coding agents — a process name for a native binary,
/// an entry-script name for a scripted one. Kept lowercase.
///
/// Everything the launcher menu can start (see `src/lib/agentLaunchers.ts`)
/// belongs here too, or a one-click launch would run an agent the badge, the
/// dashboard and the idle timer all treat as a plain shell. Names to watch:
/// `agy` is Antigravity's actual binary (there is no `antigravity` one),
/// ZCode's runtime runs through its Electron shell, so the process shows up as
/// `ZCode` — matched case-insensitively below — and Qoder needs both of its
/// spellings, because which one appears depends on how it was started (see
/// `agent_of_parts`).
const AGENT_NAMES: &[&str] = &[
    "claude",
    "codex",
    "zcode",
    "antigravity",
    "agy",
    "dsh",
    "aider",
    "amp",
    "cline",
    "cursor-agent",
    "gemini",
    "goose",
    "opencode",
    "kiro",
    "qoder",
    "qodercli",
];

/// Interpreters that run an agent as a script rather than being one.
///
/// A shebang script is executed as `<interpreter> <script>`, so the process
/// table only ever shows the interpreter — an npm-installed agent is `node`
/// and a pipx-installed one is `python3.13`. Matching names alone therefore
/// misses Qoder, DeepSeek Harness and Aider entirely; for these, argv is
/// consulted instead. Anything starting with `python` counts, since those
/// binaries carry their version in the name.
const SCRIPT_RUNNERS: &[&str] = &["node", "bun", "deno", "python"];

/// Entry-script extensions, stripped before matching so that the observed
/// `qodercli.js` lines up with the `qodercli` in `AGENT_NAMES`.
const SCRIPT_EXTS: &[&str] = &[".js", ".mjs", ".cjs", ".ts", ".py"];

#[derive(Default)]
pub struct AgentState {
    current: Mutex<HashMap<String, String>>,
}

impl AgentState {
    pub fn new() -> Self {
        Self::default()
    }
}

pub fn spawn_monitor(app: AppHandle) {
    thread::spawn(move || {
        let mut sys = System::new();
        loop {
            thread::sleep(POLL_INTERVAL);

            let pty_manager = app.state::<PtyManager>();
            let shell_pids = pty_manager.shell_pids();
            if shell_pids.is_empty() {
                continue;
            }

            // Argv, and nothing else. The convenience `refresh_processes`
            // collects cpu, memory and disk usage this monitor never reads,
            // and leaves out the one field it needs — without `with_cmd` the
            // command line comes back empty for every process, which is what
            // hid every scripted agent (see `agent_of_parts`). `OnlyIfNotSet`
            // because argv is fixed at exec: fetch it once per process, not
            // every two seconds.
            sys.refresh_processes_specifics(
                ProcessesToUpdate::All,
                true,
                ProcessRefreshKind::nothing().with_cmd(UpdateKind::OnlyIfNotSet),
            );
            let children_of = build_children_map(&sys);

            let agent_state = app.state::<AgentState>();
            let mut current = agent_state.current.lock();

            // Drop entries for sessions that no longer exist (tab closed,
            // shell exited) so the map can't grow without bound across a
            // long-lived app run.
            let live: HashSet<&String> = shell_pids.iter().map(|(id, _)| id).collect();
            current.retain(|id, _| live.contains(id));

            for (session_id, shell_pid) in &shell_pids {
                let agent = find_agent_in_tree(&sys, &children_of, Pid::from_u32(*shell_pid));
                let prev = current.get(session_id).cloned();
                if prev != agent {
                    let topic = format!("pty://agent/{}", session_id);
                    match &agent {
                        Some(a) => {
                            current.insert(session_id.clone(), a.clone());
                            let _ = app.emit(&topic, Some(a.clone()));
                        }
                        None => {
                            current.remove(session_id);
                            let _ = app.emit::<Option<String>>(&topic, None);
                        }
                    }
                }
            }
        }
    });
}

fn build_children_map(sys: &System) -> HashMap<Pid, Vec<Pid>> {
    let mut children_of: HashMap<Pid, Vec<Pid>> = HashMap::new();
    for (pid, process) in sys.processes() {
        if let Some(parent) = process.parent() {
            children_of.entry(parent).or_default().push(*pid);
        }
    }
    children_of
}

fn find_agent_in_tree(
    sys: &System,
    children_of: &HashMap<Pid, Vec<Pid>>,
    root_pid: Pid,
) -> Option<String> {
    let mut queue = vec![root_pid];
    let mut seen: HashSet<Pid> = HashSet::new();
    while let Some(pid) = queue.pop() {
        if !seen.insert(pid) {
            continue;
        }
        let Some(children) = children_of.get(&pid) else {
            continue;
        };
        for child in children {
            if let Some(proc) = sys.process(*child) {
                if let Some(agent) = agent_of(proc) {
                    return Some(agent);
                }
                queue.push(*child);
            }
        }
    }
    None
}

/// The agent a live process represents, if any.
fn agent_of(proc: &sysinfo::Process) -> Option<String> {
    let name = proc.name().to_string_lossy();
    // argv[0] is the interpreter itself and flags may precede the script, so
    // the entry script is the first argument after argv[0] that isn't a flag.
    let script = proc
        .cmd()
        .iter()
        .skip(1)
        .map(|arg| arg.to_string_lossy())
        .find(|arg| !arg.starts_with('-'));
    agent_of_parts(&name, script.as_deref())
}

/// The matching rules, split out from the process table so they can be tested.
///
/// Two shapes have to be recognized. A native binary (claude, codex, opencode)
/// puts its own name in the process table, so the name is matched directly. A
/// scripted one is invisible that way — the process is `node` or `python` —
/// so its entry script's file name is matched instead.
///
/// What that script path looks like depends on how the tool was started, and
/// both forms show up in practice: the kernel passes the path *as invoked*, so
/// a bin symlink keeps its own name (typing `dsh` yields `node …/bin/dsh`,
/// giving `dsh`), while a dispatcher that spawns a resolved bundle reports
/// that instead (`qoder` re-launches `node …/bundle/qodercli.js`, giving
/// `qodercli`) — which is why Qoder is listed under both spellings.
///
/// The script name has to match an entry outright, not merely contain one, or
/// a personal `node ~/claude-notes.js` would light up the agent badge.
fn agent_of_parts(name: &str, script: Option<&str>) -> Option<String> {
    let name = strip_exe_suffix(base_name(name));
    if let Some(agent) = match_agent(name) {
        return Some(agent);
    }
    if !is_script_runner(name) {
        return None;
    }
    let script = strip_script_ext(strip_exe_suffix(base_name(script?)));
    match_agent(script)
}

fn match_agent(candidate: &str) -> Option<String> {
    AGENT_NAMES
        .iter()
        .any(|a| candidate.eq_ignore_ascii_case(a))
        .then(|| candidate.to_string())
}

fn is_script_runner(name: &str) -> bool {
    SCRIPT_RUNNERS.iter().any(|r| {
        name.eq_ignore_ascii_case(r)
            || (*r == "python" && name.len() > r.len() && name[..r.len()].eq_ignore_ascii_case(r))
    })
}

/// Last path segment, for both separators — a Windows agent arrives as
/// `node C:\Users\...\qodercli.js`.
fn base_name(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

/// Windows reports process names with a `.exe` suffix (e.g. "claude.exe"),
/// which never matches `AGENT_NAMES` as-is. macOS/Linux names have no
/// extension, so this is a no-op there.
fn strip_exe_suffix(name: &str) -> &str {
    strip_suffix_ci(name, ".exe")
}

fn strip_script_ext(name: &str) -> &str {
    SCRIPT_EXTS
        .iter()
        .find_map(|ext| {
            let trimmed = strip_suffix_ci(name, ext);
            (trimmed.len() < name.len()).then_some(trimmed)
        })
        .unwrap_or(name)
}

/// `str::strip_suffix`, case-insensitively, and never panicking: `get` returns
/// `None` rather than slicing through a multi-byte character, which a name
/// like "钉钉会议" in the process tree would otherwise do.
fn strip_suffix_ci<'a>(name: &'a str, suffix: &str) -> &'a str {
    let Some(cut) = name.len().checked_sub(suffix.len()) else {
        return name;
    };
    if cut == 0 {
        return name;
    }
    match name.get(cut..) {
        Some(tail) if tail.eq_ignore_ascii_case(suffix) => &name[..cut],
        _ => name,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_windows_exe_suffix_case_insensitively() {
        assert_eq!(strip_exe_suffix("claude.exe"), "claude");
        assert_eq!(strip_exe_suffix("Claude.EXE"), "Claude");
        assert_eq!(strip_exe_suffix("cursor-agent.Exe"), "cursor-agent");
    }

    #[test]
    fn leaves_unix_style_names_untouched() {
        assert_eq!(strip_exe_suffix("claude"), "claude");
        assert_eq!(strip_exe_suffix("codex"), "codex");
    }

    #[test]
    fn does_not_panic_on_short_names() {
        assert_eq!(strip_exe_suffix(""), "");
        assert_eq!(strip_exe_suffix("sh"), "sh");
        assert_eq!(strip_exe_suffix(".exe"), ".exe");
    }

    // The monitor walks every process under every shell, so one CJK-named
    // process used to be enough to slice through a character boundary and
    // take the whole thread down.
    #[test]
    fn does_not_panic_on_multi_byte_names() {
        assert_eq!(strip_exe_suffix("钉钉会议"), "钉钉会议");
        assert_eq!(strip_script_ext("微信"), "微信");
    }

    #[test]
    fn matches_a_native_binary_by_its_process_name() {
        assert_eq!(agent_of_parts("claude", None).as_deref(), Some("claude"));
        assert_eq!(
            agent_of_parts("claude.exe", None).as_deref(),
            Some("claude"),
        );
        assert_eq!(agent_of_parts("ZCode", None).as_deref(), Some("ZCode"));
        assert_eq!(agent_of_parts("bash", None), None);
    }

    // The reason this function exists: npm- and pipx-installed agents run as
    // `node`/`python`, so the process name says nothing about which tool it is.
    #[test]
    fn falls_back_to_the_entry_script_for_interpreters() {
        // A bin symlink keeps its own name: typing `dsh` runs `node …/bin/dsh`.
        assert_eq!(
            agent_of_parts("node", Some("/opt/node/bin/dsh")).as_deref(),
            Some("dsh"),
        );
        // Qoder's dispatcher re-launches the resolved bundle instead.
        assert_eq!(
            agent_of_parts("node", Some("/opt/@qoder-ai/qodercli/bundle/qodercli.js")).as_deref(),
            Some("qodercli"),
        );
        assert_eq!(
            agent_of_parts("python3.13", Some("/opt/pipx/bin/aider.py")).as_deref(),
            Some("aider"),
        );
        assert_eq!(
            agent_of_parts("node.exe", Some("C:\\npm\\node_modules\\qoder.js")).as_deref(),
            Some("qoder"),
        );
    }

    #[test]
    fn ignores_interpreter_flags_before_the_script() {
        assert_eq!(
            agent_of_parts("node", Some("--enable-source-maps")),
            None,
            "callers pass the first non-flag argument; a flag reaching here is not a script",
        );
    }

    // A name that merely contains an agent's is somebody's own script.
    #[test]
    fn does_not_match_a_script_that_only_looks_like_an_agent() {
        assert_eq!(agent_of_parts("node", Some("~/claude-notes.js")), None);
        assert_eq!(agent_of_parts("node", Some("/srv/my-codex/app.js")), None);
    }

    // Only interpreters get the argv treatment; a real binary's arguments are
    // its own business.
    #[test]
    fn does_not_read_argv_for_a_non_interpreter() {
        assert_eq!(agent_of_parts("vim", Some("/tmp/claude")), None);
    }
}

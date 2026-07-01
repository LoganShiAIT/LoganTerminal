use std::collections::{HashMap, HashSet};
use std::thread;
use std::time::Duration;

use parking_lot::Mutex;
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::pty::PtyManager;

const POLL_INTERVAL: Duration = Duration::from_millis(2000);

/// Binary names we recognize as coding agents. Kept lowercase.
const AGENT_NAMES: &[&str] = &[
    "claude",
    "codex",
    "aider",
    "amp",
    "cline",
    "cursor-agent",
    "gemini",
    "goose",
    "opencode",
    "kiro",
];

#[derive(Default)]
pub struct AgentState {
    current: Mutex<HashMap<String, String>>,
}

impl AgentState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn snapshot(&self) -> HashMap<String, String> {
        self.current.lock().clone()
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

            sys.refresh_processes(ProcessesToUpdate::All, true);
            let children_of = build_children_map(&sys);

            let agent_state = app.state::<AgentState>();
            let mut current = agent_state.current.lock();

            for (session_id, shell_pid) in shell_pids {
                let agent = find_agent_in_tree(&sys, &children_of, Pid::from_u32(shell_pid));
                let prev = current.get(&session_id).cloned();
                if prev != agent {
                    let topic = format!("pty://agent/{}", session_id);
                    match &agent {
                        Some(a) => {
                            current.insert(session_id.clone(), a.clone());
                            let _ = app.emit(&topic, Some(a.clone()));
                        }
                        None => {
                            current.remove(&session_id);
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
                let name = proc.name().to_string_lossy();
                let normalized = strip_exe_suffix(&name);
                if AGENT_NAMES
                    .iter()
                    .any(|a| normalized.eq_ignore_ascii_case(a))
                {
                    return Some(normalized.to_string());
                }
                queue.push(*child);
            }
        }
    }
    None
}

/// Windows reports process names with a `.exe` suffix (e.g. "claude.exe"),
/// which never matches `AGENT_NAMES` as-is. macOS/Linux names have no
/// extension, so this is a no-op there.
fn strip_exe_suffix(name: &str) -> &str {
    if name.len() > 4 && name[name.len() - 4..].eq_ignore_ascii_case(".exe") {
        &name[..name.len() - 4]
    } else {
        name
    }
}

#[tauri::command]
pub fn agent_snapshot(state: State<'_, AgentState>) -> HashMap<String, String> {
    state.snapshot()
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
}

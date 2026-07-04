use std::collections::HashMap;
use std::io::{Read, Write};

use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

pub struct PtySession {
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
    pub shell_pid: Option<u32>,
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn spawn(
        &self,
        app: AppHandle,
        requested_id: Option<String>,
        rows: u16,
        cols: u16,
        shell: Option<String>,
        cwd: Option<String>,
    ) -> anyhow::Result<String> {
        let id = requested_id
            .map(validate_session_id)
            .transpose()?
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        if self.sessions.lock().contains_key(&id) {
            anyhow::bail!("session {} already exists", id);
        }
        let pty_system = native_pty_system();

        let pair = pty_system.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        let shell_path = shell.unwrap_or_else(default_shell);
        let mut cmd = CommandBuilder::new(&shell_path);
        if let Some(dir) = cwd.or_else(default_start_dir) {
            cmd.cwd(dir);
        }

        let shell_base = shell_base_name(&shell_path);
        let zdotdir = if shell_base == "zsh" {
            ensure_zsh_hook_dir().ok()
        } else {
            None
        };
        // bash gets the same OSC 7/133 integration via --rcfile (which
        // replaces the rc files bash would read on its own, so the generated
        // file chains them first). Unix-only: a bash.exe on Windows (Git
        // Bash, WSL) may not resolve the Windows-style path we'd hand it,
        // so it keeps stock behavior there.
        #[cfg(unix)]
        if shell_base == "bash" {
            if let Ok(rc) = ensure_bash_hook_file() {
                cmd.arg("--rcfile");
                cmd.arg(rc);
            }
        }

        for (k, v) in std::env::vars() {
            if zdotdir.is_some() && k == "ZDOTDIR" {
                continue;
            }
            cmd.env(k, v);
        }
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        if let Some(zd) = zdotdir {
            cmd.env("ZDOTDIR", zd);
        }

        let child = pair.slave.spawn_command(cmd)?;
        drop(pair.slave);

        let shell_pid = child.process_id();
        let mut reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;

        let id_clone = id.clone();
        let app_clone = app.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            let mut osc = OscBuf::default();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        for payload in osc.feed(&buf[..n]) {
                            if let Some(cwd) = parse_osc7(&payload) {
                                let _ = app_clone.emit(&format!("pty://cwd/{}", id_clone), cwd);
                                continue;
                            }
                            if let Some((title, body)) = parse_notification(&payload) {
                                let _ = app_clone
                                    .notification()
                                    .builder()
                                    .title(title)
                                    .body(body)
                                    .show();
                            }
                        }
                        let data = String::from_utf8_lossy(&buf[..n]).into_owned();
                        if app_clone
                            .emit(&format!("pty://data/{}", id_clone), data)
                            .is_err()
                        {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            app_clone.state::<PtyManager>().remove(&id_clone);
            let _ = app_clone.emit(&format!("pty://exit/{}", id_clone), ());
        });

        self.sessions.lock().insert(
            id.clone(),
            PtySession {
                master: pair.master,
                writer,
                child,
                shell_pid,
            },
        );

        Ok(id)
    }

    pub fn shell_pids(&self) -> Vec<(String, u32)> {
        self.sessions
            .lock()
            .iter()
            .filter_map(|(id, sess)| sess.shell_pid.map(|p| (id.clone(), p)))
            .collect()
    }

    pub fn write(&self, id: &str, data: &str) -> anyhow::Result<()> {
        let mut sessions = self.sessions.lock();
        let session = sessions
            .get_mut(id)
            .ok_or_else(|| anyhow::anyhow!("session {} not found", id))?;
        session.writer.write_all(data.as_bytes())?;
        session.writer.flush()?;
        Ok(())
    }

    pub fn resize(&self, id: &str, rows: u16, cols: u16) -> anyhow::Result<()> {
        let sessions = self.sessions.lock();
        let session = sessions
            .get(id)
            .ok_or_else(|| anyhow::anyhow!("session {} not found", id))?;
        session.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        Ok(())
    }

    pub fn kill(&self, id: &str) -> anyhow::Result<()> {
        let mut sessions = self.sessions.lock();
        if let Some(mut session) = sessions.remove(id) {
            let _ = session.child.kill();
        }
        Ok(())
    }

    /// Evicts a session once its reader thread has observed the process
    /// exit, so a shell the user quit (e.g. via `exit`) doesn't hold onto
    /// PTY handles indefinitely while the tab stays open.
    pub fn remove(&self, id: &str) {
        self.sessions.lock().remove(id);
    }
}

fn validate_session_id(id: String) -> anyhow::Result<String> {
    uuid::Uuid::parse_str(&id).map_err(|_| anyhow::anyhow!("invalid session id"))?;
    Ok(id)
}

#[cfg(unix)]
fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
}

#[cfg(windows)]
fn default_shell() -> String {
    "powershell.exe".to_string()
}

/// Falls back to the user's Documents folder when a spawn request has no
/// explicit cwd (fresh tab, no directory to inherit from). Only used if the
/// folder actually exists, so an unusual setup just keeps the OS default.
fn default_start_dir() -> Option<String> {
    let home_var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    let home = std::env::var(home_var).ok()?;
    let sep = if cfg!(windows) { '\\' } else { '/' };
    let docs = format!("{home}{sep}Documents");
    std::path::Path::new(&docs).is_dir().then_some(docs)
}

/// Small streaming parser for OSC (Operating System Command) sequences.
/// An OSC begins with `ESC ]` and ends with either BEL (0x07) or ST (`ESC \`).
#[derive(Default)]
struct OscBuf {
    inside: bool,
    saw_esc: bool,
    buf: Vec<u8>,
}

impl OscBuf {
    fn feed(&mut self, chunk: &[u8]) -> Vec<Vec<u8>> {
        let mut out = Vec::new();
        let mut i = 0;
        while i < chunk.len() {
            let byte = chunk[i];
            if !self.inside {
                if self.saw_esc && byte == b']' {
                    self.inside = true;
                    self.saw_esc = false;
                    self.buf.clear();
                } else {
                    self.saw_esc = byte == 0x1b;
                }
                i += 1;
            } else {
                if byte == 0x07 {
                    out.push(std::mem::take(&mut self.buf));
                    self.inside = false;
                    self.saw_esc = false;
                    i += 1;
                } else if byte == 0x1b {
                    // Expect the next byte to be '\' (ST)
                    if i + 1 < chunk.len() && chunk[i + 1] == b'\\' {
                        out.push(std::mem::take(&mut self.buf));
                        self.inside = false;
                        self.saw_esc = false;
                        i += 2;
                    } else {
                        // Malformed — abort this OSC
                        self.buf.clear();
                        self.inside = false;
                        self.saw_esc = false;
                        i += 1;
                    }
                } else {
                    if self.buf.len() >= 4096 {
                        self.buf.clear();
                        self.inside = false;
                    } else {
                        self.buf.push(byte);
                    }
                    i += 1;
                }
            }
        }
        out
    }
}

fn parse_osc7(payload: &[u8]) -> Option<String> {
    let s = std::str::from_utf8(payload).ok()?;
    let rest = s.strip_prefix("7;")?;
    // rest is typically "file://hostname/path"
    let after_scheme = rest.strip_prefix("file://").unwrap_or(rest);
    // Skip optional hostname component up to the first '/'
    let path_start = after_scheme.find('/')?;
    let path = &after_scheme[path_start..];
    Some(percent_decode(path))
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(a), Some(b)) = (hex_nibble(bytes[i + 1]), hex_nibble(bytes[i + 2])) {
                out.push((a << 4) | b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_nibble(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

/// Extracts a (title, body) pair from OSC 9 / 99 / 777 notification sequences.
fn parse_notification(payload: &[u8]) -> Option<(String, String)> {
    let s = std::str::from_utf8(payload).ok()?;
    let (num, rest) = s.split_once(';')?;
    match num {
        "9" => {
            // iTerm/wezterm: `9;message` or `9;title;body`
            if let Some((title, body)) = rest.split_once(';') {
                Some((title.to_string(), body.to_string()))
            } else if !rest.is_empty() {
                Some(("LoganTerminal".to_string(), rest.to_string()))
            } else {
                None
            }
        }
        "777" => {
            // urxvt: `777;notify;title;body`
            let mut parts = rest.splitn(3, ';');
            let kind = parts.next()?;
            if kind != "notify" {
                return None;
            }
            let title = parts.next()?.trim().to_string();
            let body = parts.next().unwrap_or("").trim().to_string();
            if title.is_empty() && body.is_empty() {
                None
            } else {
                Some((
                    if title.is_empty() {
                        "LoganTerminal".to_string()
                    } else {
                        title
                    },
                    body,
                ))
            }
        }
        "99" => {
            // Kitty desktop notification: `99;i=id;p=payload:message` or `99;message`.
            // Keep it simple: strip any leading `i=...;p=...:` metadata.
            let body = if let Some(idx) = rest.find(':') {
                let before = &rest[..idx];
                // Only treat as metadata if the prefix looks like key=val pairs
                if before
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '=' | ';' | '_' | '-'))
                {
                    rest[idx + 1..].to_string()
                } else {
                    rest.to_string()
                }
            } else {
                rest.to_string()
            };
            if body.is_empty() {
                None
            } else {
                Some(("LoganTerminal".to_string(), body))
            }
        }
        _ => None,
    }
}

/// Base name of a shell path, lowercased, `.exe` stripped — "zsh", "bash",
/// "powershell", ... Used to pick which shell-integration hooks to inject.
/// Exact-match comparisons on the result mean e.g. a shell named "notzsh"
/// gets none (the old `ends_with("zsh")` check would have matched it).
fn shell_base_name(path: &str) -> String {
    let base = path.rsplit(['/', '\\']).next().unwrap_or(path);
    let base = base.to_ascii_lowercase();
    base.strip_suffix(".exe").map(str::to_owned).unwrap_or(base)
}

/// Set up a ZDOTDIR that emits OSC 7 (cwd) and OSC 133 (shell-integration
/// prompt/command markers, consumed by the frontend's xterm OSC handler —
/// see Terminal.tsx) from zsh's precmd/preexec hooks.
/// Returns the ZDOTDIR path to inject into the environment.
fn ensure_zsh_hook_dir() -> anyhow::Result<String> {
    let home = std::env::var("HOME")?;
    let dir = std::path::PathBuf::from(&home)
        .join(".logan-terminal")
        .join("shell");
    std::fs::create_dir_all(&dir)?;

    let zshrc = dir.join(".zshrc");
    std::fs::write(&zshrc, ZSH_RC)?;
    Ok(dir.to_string_lossy().into_owned())
}

const ZSH_RC: &str = r#"# Auto-generated by LoganTerminal — do not edit.
# Chain the user's zshrc first so we don't shadow their config.
if [[ -r "$HOME/.zshrc" ]]; then
  ZDOTDIR="$HOME" source "$HOME/.zshrc"
fi

# Runs FIRST among precmd hooks so $? still reflects the command that just
# finished, before any other precmd hook (theme, framework, ...) gets a
# chance to run something that clobbers it.
_logan_terminal_precmd_early() {
  printf '\e]133;D;%d\a' "$?"
}

# Runs LAST so it sees the final PROMPT after theme/framework precmd hooks
# (oh-my-zsh, powerlevel10k, ...) have finished rebuilding it.
_logan_terminal_precmd_late() {
  local host="${HOST:-${HOSTNAME:-localhost}}"
  printf '\e]7;file://%s%s\a' "$host" "$PWD"
  printf '\e]133;A\a'
  # Zero-width marker (%{...%}) so it isn't counted as visible width by
  # zle; idempotent so frameworks that redraw PROMPT unchanged don't grow
  # it every prompt.
  if [[ "$PROMPT" != *$'\e]133;B'* ]]; then
    PROMPT="${PROMPT}"'%{'$'\e]133;B\a''%}'
  fi
}

_logan_terminal_preexec() {
  printf '\e]133;C\a'
}

precmd_functions=(_logan_terminal_precmd_early "${precmd_functions[@]}")
precmd_functions+=(_logan_terminal_precmd_late)

if [[ -n "${preexec_functions+set}" ]]; then
  preexec_functions+=(_logan_terminal_preexec)
else
  preexec_functions=(_logan_terminal_preexec)
fi

# Emit once on startup so consumers get an initial cwd and prompt marker.
_logan_terminal_precmd_early
_logan_terminal_precmd_late
"#;

/// Write the bash rc file that mirrors [`ZSH_RC`]'s OSC 7/133 integration
/// and return its path, to be passed to bash via `--rcfile`.
#[cfg(unix)]
fn ensure_bash_hook_file() -> anyhow::Result<String> {
    let home = std::env::var("HOME")?;
    let dir = std::path::PathBuf::from(&home)
        .join(".logan-terminal")
        .join("shell");
    std::fs::create_dir_all(&dir)?;

    let rc = dir.join("bashrc");
    std::fs::write(&rc, BASH_RC)?;
    Ok(rc.to_string_lossy().into_owned())
}

#[cfg(unix)]
const BASH_RC: &str = r#"# Auto-generated by LoganTerminal — do not edit.
# bash reads this via --rcfile, which replaces the system/user rc files, so
# chain what bash would have read on its own before adding our hooks.
[[ $- == *i* ]] || return
[[ -r /etc/bash.bashrc ]] && source /etc/bash.bashrc
[[ -r "$HOME/.bashrc" ]] && source "$HOME/.bashrc"

# Runs FIRST in PROMPT_COMMAND so $? still reflects the command that just
# finished; `return`s that status so the user's own PROMPT_COMMAND (spliced
# right after us) still sees the real exit code in $?.
_logan_terminal_precmd_early() {
  _LOGAN_TERMINAL_STATUS=$?
  printf '\e]133;D;%d\a' "$_LOGAN_TERMINAL_STATUS"
  return "$_LOGAN_TERMINAL_STATUS"
}

# Runs LAST so it sees PS1 after the user's PROMPT_COMMAND (git prompts etc.)
# has finished rebuilding it.
_logan_terminal_precmd_late() {
  printf '\e]7;file://%s%s\a' "${HOSTNAME:-localhost}" "$PWD"
  printf '\e]133;A\a'
  # \[...\] so readline gives it zero width; idempotent so PROMPT_COMMANDs
  # that rebuild PS1 unchanged don't grow it every prompt.
  if [[ "$PS1" != *']133;B'* ]]; then
    PS1="${PS1}\\[\\e]133;B\\a\\]"
  fi
}

if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == 'declare -a'* ]]; then
  PROMPT_COMMAND=(_logan_terminal_precmd_early "${PROMPT_COMMAND[@]}" _logan_terminal_precmd_late)
else
  _logan_terminal_user_pc="${PROMPT_COMMAND-}"
  while [[ "$_logan_terminal_user_pc" == *[';'$' \t\n'] ]]; do
    _logan_terminal_user_pc="${_logan_terminal_user_pc%?}"
  done
  PROMPT_COMMAND="_logan_terminal_precmd_early${_logan_terminal_user_pc:+; $_logan_terminal_user_pc}; _logan_terminal_precmd_late"
  unset _logan_terminal_user_pc
fi

# PS0 (bash >= 4.4) expands after a command is read, before it runs — the
# preexec moment. On older bash (macOS ships 3.2) it's an unused variable:
# the C marker simply never fires, everything else still works.
PS0="${PS0-}\\e]133;C\\a"

# Emit once on startup so consumers get an initial cwd and prompt marker.
_logan_terminal_precmd_early
_logan_terminal_precmd_late
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_start_dir_targets_documents_when_present() {
        if let Some(dir) = default_start_dir() {
            assert!(dir.ends_with("Documents"));
            assert!(std::path::Path::new(&dir).is_dir());
        }
    }

    #[test]
    fn osc7_bel_terminated() {
        let mut buf = OscBuf::default();
        let input = b"prefix\x1b]7;file://localhost/tmp/foo\x07suffix";
        let out = buf.feed(input);
        assert_eq!(out.len(), 1);
        assert_eq!(&out[0], b"7;file://localhost/tmp/foo");
        assert_eq!(parse_osc7(&out[0]).as_deref(), Some("/tmp/foo"));
    }

    #[test]
    fn osc7_st_terminated() {
        let mut buf = OscBuf::default();
        let input = b"\x1b]7;file://host/path\x1b\\";
        let out = buf.feed(input);
        assert_eq!(out.len(), 1);
        assert_eq!(parse_osc7(&out[0]).as_deref(), Some("/path"));
    }

    #[test]
    fn osc7_split_across_chunks() {
        let mut buf = OscBuf::default();
        let a = buf.feed(b"\x1b]7;file://host/pa");
        let b = buf.feed(b"th with %20space\x07");
        assert!(a.is_empty());
        assert_eq!(b.len(), 1);
        assert_eq!(parse_osc7(&b[0]).as_deref(), Some("/path with  space"));
    }

    #[test]
    fn osc7_percent_decoding() {
        let payload = b"7;file://h/Users/foo/%E4%B8%AD%E6%96%87";
        assert_eq!(parse_osc7(payload).as_deref(), Some("/Users/foo/中文"));
    }

    #[test]
    fn osc7_missing_scheme_hostname() {
        // Some emitters send just the path
        let payload = b"7;/tmp/bare";
        assert_eq!(parse_osc7(payload).as_deref(), Some("/tmp/bare"));
    }

    #[test]
    fn non_osc7_ignored() {
        let mut buf = OscBuf::default();
        // OSC 0 (set title) — feed should still yield it but parse_osc7 rejects
        let out = buf.feed(b"\x1b]0;My Title\x07");
        assert_eq!(out.len(), 1);
        assert!(parse_osc7(&out[0]).is_none());
    }

    #[test]
    fn notification_osc9_single_message() {
        let payload = b"9;Build finished";
        assert_eq!(
            parse_notification(payload),
            Some(("LoganTerminal".to_string(), "Build finished".to_string()))
        );
    }

    #[test]
    fn notification_osc9_title_body() {
        let payload = b"9;Claude Code;Waiting for input";
        assert_eq!(
            parse_notification(payload),
            Some(("Claude Code".to_string(), "Waiting for input".to_string()))
        );
    }

    #[test]
    fn notification_osc777_urxvt_form() {
        let payload = b"777;notify;Build;OK";
        assert_eq!(
            parse_notification(payload),
            Some(("Build".to_string(), "OK".to_string()))
        );
    }

    #[test]
    fn notification_osc777_non_notify_rejected() {
        let payload = b"777;preexec;something";
        assert_eq!(parse_notification(payload), None);
    }

    #[test]
    fn notification_osc99_kitty_metadata_stripped() {
        let payload = b"99;i=abc;p=body:actually the message";
        assert_eq!(
            parse_notification(payload),
            Some((
                "LoganTerminal".to_string(),
                "actually the message".to_string()
            ))
        );
    }

    #[test]
    fn notification_osc99_plain() {
        let payload = b"99;hello";
        assert_eq!(
            parse_notification(payload),
            Some(("LoganTerminal".to_string(), "hello".to_string()))
        );
    }

    #[test]
    fn notification_ignores_osc0_title() {
        let payload = b"0;My Title";
        assert_eq!(parse_notification(payload), None);
    }

    #[test]
    fn max_buffer_prevents_runaway() {
        let mut buf = OscBuf::default();
        let mut input = b"\x1b]7;".to_vec();
        input.extend(std::iter::repeat_n(b'x', 8000));
        let out = buf.feed(&input);
        // Should not emit — got aborted for being too large, and never terminated.
        assert!(out.is_empty());
    }

    #[test]
    fn validates_requested_session_ids() {
        let id = uuid::Uuid::new_v4().to_string();
        assert_eq!(validate_session_id(id.clone()).unwrap(), id);
        assert!(validate_session_id("pty://bad/topic".to_string()).is_err());
    }

    #[test]
    fn shell_base_name_variants() {
        assert_eq!(shell_base_name("/bin/zsh"), "zsh");
        assert_eq!(shell_base_name("/opt/homebrew/bin/bash"), "bash");
        assert_eq!(shell_base_name("bash"), "bash");
        assert_eq!(
            shell_base_name(r"C:\Program Files\Git\bin\bash.exe"),
            "bash"
        );
        assert_eq!(
            shell_base_name(r"C:\WINDOWS\System32\PowerShell.EXE"),
            "powershell"
        );
        // Exact match wanted: a shell that merely *ends* in "zsh" is not zsh.
        assert_eq!(shell_base_name("/usr/local/bin/notzsh"), "notzsh");
    }

    #[test]
    fn zsh_rc_covers_all_osc_markers() {
        for marker in ["]133;A", "]133;B", "]133;C", "]133;D", "]7;file://"] {
            assert!(ZSH_RC.contains(marker), "zsh rc lost marker {marker}");
        }
    }

    #[test]
    #[cfg(unix)]
    fn bash_rc_covers_all_osc_markers() {
        for marker in ["]133;A", "]133;B", "]133;C", "]133;D", "]7;file://"] {
            assert!(BASH_RC.contains(marker), "bash rc lost marker {marker}");
        }
    }

    /// Runs the generated rc file in a real interactive bash (present on
    /// every unix dev/CI machine) and checks the sequences it emits. The C
    /// marker is deliberately not asserted — it needs PS0 (bash >= 4.4) and
    /// macOS ships 3.2.
    #[test]
    #[cfg(unix)]
    fn bash_rc_emits_markers_in_a_real_bash() {
        use std::process::{Command, Stdio};

        let dir = std::env::temp_dir().join(format!("logan-bashrc-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let rc = dir.join("bashrc");
        std::fs::write(&rc, BASH_RC).unwrap();

        let mut child = Command::new("bash")
            .arg("--rcfile")
            .arg(&rc)
            .arg("-i")
            // Point HOME at the empty temp dir so no user .bashrc interferes.
            .env("HOME", &dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("bash should be available on unix");
        child
            .stdin
            .as_mut()
            .unwrap()
            .write_all(b"false\nexit\n")
            .unwrap();
        let out = child.wait_with_output().unwrap();
        let all = format!(
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );

        assert!(
            all.contains("\x1b]133;A\x07"),
            "prompt marker missing: {all:?}"
        );
        assert!(
            all.contains("\x1b]133;D;1\x07"),
            "exit-code marker for `false` missing: {all:?}"
        );
        assert!(
            all.contains("\x1b]133;D;0\x07"),
            "startup D;0 missing: {all:?}"
        );
        assert!(all.contains("\x1b]7;file://"), "osc7 cwd missing: {all:?}");
        assert!(
            all.contains("\x1b]133;B\x07"),
            "PS1 input marker missing: {all:?}"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}

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
            // Login shell: a Dock-launched .app inherits a minimal PATH, and
            // the fix-ups live in /etc/zprofile (path_helper) and the user's
            // ~/.zprofile (Homebrew et al) — both read by login shells only.
            // Every macOS terminal spawns login shells for the same reason.
            cmd.arg("-l");
            ensure_zsh_hook_dir().ok()
        } else {
            None
        };
        // bash gets the same OSC 7/133 integration via --rcfile. A login
        // (-l) bash would ignore --rcfile entirely, so BASH_RC instead
        // emulates the full login + interactive startup sequence itself.
        // Unix-only: a bash.exe on Windows (Git Bash, WSL) may not resolve
        // the Windows-style path we'd hand it, so it keeps stock behavior
        // there.
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
            // Bytes of a multi-byte UTF-8 character whose remainder is still
            // in the pipe — decoding it lossily now would emit U+FFFD, so it
            // carries over and prepends to the next chunk.
            let mut pending: Vec<u8> = Vec::new();
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
                        pending.extend_from_slice(&buf[..n]);
                        let keep = utf8_incomplete_tail_start(&pending);
                        let tail = pending.split_off(keep);
                        let data = String::from_utf8_lossy(&pending).into_owned();
                        pending = tail;
                        if !data.is_empty()
                            && app_clone
                                .emit(&format!("pty://data/{}", id_clone), data)
                                .is_err()
                        {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            // A tail still held back at EOF is genuinely truncated — flush
            // it so the last bytes aren't silently dropped.
            if !pending.is_empty() {
                let data = String::from_utf8_lossy(&pending).into_owned();
                let _ = app_clone.emit(&format!("pty://data/{}", id_clone), data);
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
        // Take the session out under the lock but kill/reap outside it, so
        // the (brief) blocking wait can't stall other PTY operations.
        let session = self.sessions.lock().remove(id);
        if let Some(mut session) = session {
            let _ = session.child.kill();
            // Reap: portable-pty's unix Child is std::process::Child, and
            // dropping one never waits — without this every closed tab
            // would leave a zombie until the app quits.
            let _ = session.child.wait();
        }
        Ok(())
    }

    /// Evicts a session once its reader thread has observed the process
    /// exit, so a shell the user quit (e.g. via `exit`) doesn't hold onto
    /// PTY handles indefinitely while the tab stays open.
    pub fn remove(&self, id: &str) {
        let session = self.sessions.lock().remove(id);
        if let Some(mut session) = session {
            // Already exited (the reader saw EOF), so this returns right
            // away — it exists purely to reap the zombie.
            let _ = session.child.wait();
        }
    }
}

/// Index at which an *incomplete* trailing UTF-8 sequence starts, or `len`
/// when the buffer ends on a complete (or unsalvageably malformed)
/// boundary. Only the final character can be cut off by a chunked read, so
/// this looks back at most 3 bytes; anything it doesn't hold back goes
/// through `from_utf8_lossy` exactly as before.
fn utf8_incomplete_tail_start(bytes: &[u8]) -> usize {
    let len = bytes.len();
    let mut i = len;
    // Step back over up to 3 continuation bytes (0b10xxxxxx).
    while i > 0 && len - i < 3 && bytes[i - 1] & 0xC0 == 0x80 {
        i -= 1;
    }
    if i == 0 {
        // Nothing but continuations — malformed, let lossy handle it.
        return len;
    }
    let lead = bytes[i - 1];
    let expected = if lead < 0x80 {
        1
    } else if lead & 0xE0 == 0xC0 {
        2
    } else if lead & 0xF0 == 0xE0 {
        3
    } else if lead & 0xF8 == 0xF0 {
        4
    } else {
        // A stray continuation/invalid lead — malformed, not incomplete.
        return len;
    };
    if len - (i - 1) < expected {
        i - 1
    } else {
        len
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
    write_zsh_hook_files(&dir)?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Writes the hook `.zshrc` plus chain stubs for every other zsh startup
/// file. Setting ZDOTDIR redirects zsh away from $HOME for *all* of them,
/// so without the stubs a login shell would skip the user's ~/.zprofile —
/// exactly the file that holds PATH setup (Homebrew) on a typical macOS
/// machine.
fn write_zsh_hook_files(dir: &std::path::Path) -> anyhow::Result<()> {
    std::fs::create_dir_all(dir)?;
    for name in [".zshenv", ".zprofile", ".zlogin"] {
        std::fs::write(dir.join(name), zsh_chain_stub(name))?;
    }
    std::fs::write(dir.join(".zshrc"), ZSH_RC)?;
    Ok(())
}

/// A ZDOTDIR stub that just runs the user's real counterpart, with ZDOTDIR
/// pointing at $HOME for its duration (zsh scopes that assignment to the
/// `source` builtin) so anything it sources relative to ZDOTDIR resolves.
fn zsh_chain_stub(name: &str) -> String {
    format!(
        r#"# Auto-generated by LoganTerminal — do not edit.
if [[ -r "$HOME/{name}" ]]; then
  ZDOTDIR="$HOME" source "$HOME/{name}"
fi
"#
    )
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

# Percent-encode $PWD byte-wise for the file:// URL — a directory literally
# named like "foo%20bar" must not decode into something else. nomultibyte
# makes subscripts/lengths byte-based so UTF-8 names encode per byte.
_logan_terminal_emit_osc7() {
  setopt localoptions nomultibyte
  local host="${HOST:-${HOSTNAME:-localhost}}" str="$PWD" out="" i ch
  for (( i = 1; i <= ${#str}; i++ )); do
    ch="${str[$i]}"
    if [[ "$ch" == [A-Za-z0-9/_.~-] ]]; then
      out+="$ch"
    else
      # "'c" may sign-extend high bytes on some shells; mask to one byte.
      printf -v ch '%d' "'$ch"
      printf -v ch '%%%02X' "$(( ch & 0xFF ))"
      out+="$ch"
    fi
  done
  printf '\e]7;file://%s%s\a' "$host" "$out"
}

# Runs LAST so it sees the final PROMPT after theme/framework precmd hooks
# (oh-my-zsh, powerlevel10k, ...) have finished rebuilding it.
_logan_terminal_precmd_late() {
  _logan_terminal_emit_osc7
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
# bash reads this via --rcfile, which replaces every startup file bash would
# read on its own — and a login (-l) bash would ignore --rcfile entirely. So
# emulate the full login + interactive sequence here: a GUI-launched app
# starts with a minimal PATH, and the fix-ups live in /etc/profile
# (path_helper) and the user's profile file (Homebrew et al).
[[ $- == *i* ]] || return
[[ -r /etc/profile ]] && source /etc/profile
# First existing profile file wins — the same rule login bash applies. A
# profile normally sources ~/.bashrc itself; only when none exists fall back
# to the plain rc chain, so nothing runs twice.
_logan_terminal_profile=
for _logan_terminal_f in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
  if [[ -r "$_logan_terminal_f" ]]; then
    _logan_terminal_profile="$_logan_terminal_f"
    break
  fi
done
if [[ -n "$_logan_terminal_profile" ]]; then
  source "$_logan_terminal_profile"
else
  [[ -r /etc/bash.bashrc ]] && source /etc/bash.bashrc
  [[ -r "$HOME/.bashrc" ]] && source "$HOME/.bashrc"
fi
unset _logan_terminal_profile _logan_terminal_f

# Runs FIRST in PROMPT_COMMAND so $? still reflects the command that just
# finished; `return`s that status so the user's own PROMPT_COMMAND (spliced
# right after us) still sees the real exit code in $?.
_logan_terminal_precmd_early() {
  _LOGAN_TERMINAL_STATUS=$?
  printf '\e]133;D;%d\a' "$_LOGAN_TERMINAL_STATUS"
  return "$_LOGAN_TERMINAL_STATUS"
}

# Percent-encode $PWD byte-wise for the file:// URL — a directory literally
# named like "foo%20bar" must not decode into something else. LC_ALL=C makes
# ${str:i:1} byte-based so UTF-8 names encode per byte (works on bash 3.2).
_logan_terminal_emit_osc7() {
  local LC_ALL=C str="$PWD" out="" i ch
  for (( i = 0; i < ${#str}; i++ )); do
    ch="${str:i:1}"
    case "$ch" in
      [A-Za-z0-9/_.~-]) out+="$ch" ;;
      *)
        # bash 3.2's "'c" sign-extends high bytes to negative values —
        # mask to one byte before formatting.
        printf -v ch '%d' "'$ch"
        printf -v ch '%%%02X' "$(( ch & 0xFF ))"
        out+="$ch" ;;
    esac
  done
  printf '\e]7;file://%s%s\a' "${HOSTNAME:-localhost}" "$out"
}

# Runs LAST so it sees PS1 after the user's PROMPT_COMMAND (git prompts etc.)
# has finished rebuilding it.
_logan_terminal_precmd_late() {
  _logan_terminal_emit_osc7
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

    #[test]
    fn utf8_tail_detection() {
        // Complete or empty — nothing held back.
        assert_eq!(utf8_incomplete_tail_start(b"plain ascii"), 11);
        assert_eq!(utf8_incomplete_tail_start("中文".as_bytes()), 6);
        assert_eq!(utf8_incomplete_tail_start(b""), 0);
        // Split multi-byte sequences — hold back the partial tail.
        let zh = "中".as_bytes(); // e4 b8 ad
        assert_eq!(utf8_incomplete_tail_start(&zh[..1]), 0);
        assert_eq!(utf8_incomplete_tail_start(&zh[..2]), 0);
        let mut buf = b"abc".to_vec();
        buf.extend_from_slice(&zh[..2]);
        assert_eq!(utf8_incomplete_tail_start(&buf), 3);
        let crab = "🦀".as_bytes(); // f0 9f a6 80
        for cut in 1..crab.len() {
            let mut b = b"x".to_vec();
            b.extend_from_slice(&crab[..cut]);
            assert_eq!(utf8_incomplete_tail_start(&b), 1, "cut at {cut}");
        }
        // Malformed (stray continuations) — hand to lossy now, don't stall.
        assert_eq!(utf8_incomplete_tail_start(&[0x80, 0x80, 0x80, 0x80]), 4);
        assert_eq!(utf8_incomplete_tail_start(&[0x80, 0x80]), 2);
    }

    /// Mirrors the reader-loop carry algorithm: however a multi-byte char
    /// gets cut across chunk reads, the decoded stream must come out
    /// identical — no U+FFFD from chunking.
    #[test]
    fn utf8_carry_reassembles_split_chunks() {
        let text = "ls 中文 🦀 done";
        let bytes = text.as_bytes();
        for cut in 0..=bytes.len() {
            let mut pending: Vec<u8> = Vec::new();
            let mut out = String::new();
            for chunk in [&bytes[..cut], &bytes[cut..]] {
                pending.extend_from_slice(chunk);
                let keep = utf8_incomplete_tail_start(&pending);
                let tail = pending.split_off(keep);
                out.push_str(&String::from_utf8_lossy(&pending));
                pending = tail;
            }
            // EOF flush of any held-back remainder.
            out.push_str(&String::from_utf8_lossy(&pending));
            assert_eq!(out, text, "cut at {cut}");
        }
    }

    /// Real interactive zsh in a cwd that needs encoding (space, literal
    /// '%', multibyte) — the emitted OSC 7 must be byte-wise
    /// percent-encoded so the frontend decode can't mangle it.
    #[test]
    #[cfg(unix)]
    fn zsh_rc_percent_encodes_osc7_pwd() {
        use std::process::{Command, Stdio};

        let base = std::env::temp_dir().join(format!("logan-zsh-enc-test-{}", std::process::id()));
        let home = base.join("home");
        let weird = home.join("we ird%40中");
        std::fs::create_dir_all(&weird).unwrap();
        let zdot = base.join("zdot");
        write_zsh_hook_files(&zdot).unwrap();

        let mut child = match Command::new("zsh")
            .arg("-i")
            .env("HOME", &home)
            .env("ZDOTDIR", &zdot)
            .current_dir(&weird)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(_) => {
                // No zsh on this machine — nothing to test.
                let _ = std::fs::remove_dir_all(&base);
                return;
            }
        };
        child.stdin.as_mut().unwrap().write_all(b"exit\n").unwrap();
        let out = child.wait_with_output().unwrap();
        let all = format!(
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        assert!(
            all.contains("we%20ird%2540%E4%B8%AD"),
            "encoded cwd missing from OSC 7: {all:?}"
        );

        let _ = std::fs::remove_dir_all(&base);
    }

    /// Same encoding check for the bash rc (LC_ALL=C byte-wise loop, which
    /// must also hold on macOS's bash 3.2).
    #[test]
    #[cfg(unix)]
    fn bash_rc_percent_encodes_osc7_pwd() {
        use std::process::{Command, Stdio};

        let dir = std::env::temp_dir().join(format!("logan-bash-enc-test-{}", std::process::id()));
        let weird = dir.join("we ird%40中");
        std::fs::create_dir_all(&weird).unwrap();
        let rc = dir.join("bashrc");
        std::fs::write(&rc, BASH_RC).unwrap();

        let mut child = Command::new("bash")
            .arg("--rcfile")
            .arg(&rc)
            .arg("-i")
            .env("HOME", &dir)
            .current_dir(&weird)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("bash should be available on unix");
        child.stdin.as_mut().unwrap().write_all(b"exit\n").unwrap();
        let out = child.wait_with_output().unwrap();
        let all = format!(
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        assert!(
            all.contains("we%20ird%2540%E4%B8%AD"),
            "encoded cwd missing from OSC 7: {all:?}"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn zsh_hook_dir_chains_every_user_startup_file() {
        let dir = std::env::temp_dir().join(format!("logan-zdot-test-{}", std::process::id()));
        write_zsh_hook_files(&dir).unwrap();

        for name in [".zshenv", ".zprofile", ".zlogin"] {
            let content = std::fs::read_to_string(dir.join(name)).unwrap();
            assert!(
                content.contains(&format!("source \"$HOME/{name}\"")),
                "{name} stub does not chain the user's file: {content:?}"
            );
        }
        let zshrc = std::fs::read_to_string(dir.join(".zshrc")).unwrap();
        assert_eq!(zshrc, ZSH_RC);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// End-to-end check of the login-shell PATH fix: a zsh started the way
    /// the app starts it (-l, hook ZDOTDIR, minimal env) must pick up PATH
    /// additions from ~/.zprofile via the chain stub — that's where
    /// Homebrew lives on a typical macOS machine, and a Dock-launched .app
    /// otherwise gets no PATH beyond the system defaults.
    #[test]
    #[cfg(unix)]
    fn login_zsh_reads_user_zprofile_through_hook_dir() {
        use std::process::Command;

        let base = std::env::temp_dir().join(format!("logan-zlogin-test-{}", std::process::id()));
        let home = base.join("home");
        let zdot = base.join("zdot");
        std::fs::create_dir_all(&home).unwrap();
        write_zsh_hook_files(&zdot).unwrap();
        std::fs::write(
            home.join(".zprofile"),
            "export PATH=\"$PATH:/logan-zprofile-sentinel\"\n",
        )
        .unwrap();

        let out = match Command::new("zsh")
            .args(["-l", "-c", "print -r -- $PATH"])
            .env_clear()
            .env("HOME", &home)
            .env("PATH", "/usr/bin:/bin")
            .env("ZDOTDIR", &zdot)
            .output()
        {
            Ok(out) => out,
            Err(_) => {
                // No zsh on this machine (minimal CI image) — nothing to test.
                let _ = std::fs::remove_dir_all(&base);
                return;
            }
        };
        let path = String::from_utf8_lossy(&out.stdout);
        assert!(
            path.contains("/logan-zprofile-sentinel"),
            "login zsh did not source the chained ~/.zprofile: {path:?}"
        );

        let _ = std::fs::remove_dir_all(&base);
    }

    /// The rc's login emulation must read the profile file (that's where
    /// PATH setup lives) and must not double-source ~/.bashrc when the
    /// profile already chains it — the standard macOS bash arrangement.
    #[test]
    #[cfg(unix)]
    fn bash_rc_sources_profile_and_bashrc_exactly_once() {
        use std::process::{Command, Stdio};

        let dir =
            std::env::temp_dir().join(format!("logan-bash-profile-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let rc = dir.join("bashrc");
        std::fs::write(&rc, BASH_RC).unwrap();
        std::fs::write(
            dir.join(".bash_profile"),
            "export PATH=\"$PATH:/logan-bash-profile-sentinel\"\n\
             [ -r \"$HOME/.bashrc\" ] && . \"$HOME/.bashrc\"\n",
        )
        .unwrap();
        std::fs::write(
            dir.join(".bashrc"),
            "LOGAN_BASHRC_COUNT=$((${LOGAN_BASHRC_COUNT:-0}+1))\n",
        )
        .unwrap();

        let mut child = Command::new("bash")
            .arg("--rcfile")
            .arg(&rc)
            .arg("-i")
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
            .write_all(b"echo \"PATH=$PATH RC_COUNT=$LOGAN_BASHRC_COUNT\"\nexit\n")
            .unwrap();
        let out = child.wait_with_output().unwrap();
        let all = format!(
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );

        assert!(
            all.contains("/logan-bash-profile-sentinel"),
            "profile PATH addition missing: {all:?}"
        );
        assert!(
            all.contains("RC_COUNT=1"),
            "bashrc should run exactly once (via the profile): {all:?}"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Without any profile file the rc falls back to sourcing ~/.bashrc
    /// directly, preserving the pre-login-emulation behavior.
    #[test]
    #[cfg(unix)]
    fn bash_rc_falls_back_to_bashrc_without_profile() {
        use std::process::{Command, Stdio};

        let dir =
            std::env::temp_dir().join(format!("logan-bash-rconly-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let rc = dir.join("bashrc");
        std::fs::write(&rc, BASH_RC).unwrap();
        std::fs::write(
            dir.join(".bashrc"),
            "LOGAN_BASHRC_COUNT=$((${LOGAN_BASHRC_COUNT:-0}+1))\n",
        )
        .unwrap();

        let mut child = Command::new("bash")
            .arg("--rcfile")
            .arg(&rc)
            .arg("-i")
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
            .write_all(b"echo \"RC_COUNT=$LOGAN_BASHRC_COUNT\"\nexit\n")
            .unwrap();
        let out = child.wait_with_output().unwrap();
        let all = format!(
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );

        assert!(
            all.contains("RC_COUNT=1"),
            "fallback ~/.bashrc sourcing missing or doubled: {all:?}"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}

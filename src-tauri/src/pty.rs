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

        let zdotdir = if shell_path.ends_with("zsh") {
            ensure_zsh_hook_dir().ok()
        } else {
            None
        };

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

/// Set up a ZDOTDIR that emits OSC 7 from zsh's precmd hook.
/// Returns the ZDOTDIR path to inject into the environment.
fn ensure_zsh_hook_dir() -> anyhow::Result<String> {
    let home = std::env::var("HOME")?;
    let dir = std::path::PathBuf::from(&home)
        .join(".logan-terminal")
        .join("shell");
    std::fs::create_dir_all(&dir)?;

    let zshrc = dir.join(".zshrc");
    let contents = r#"# Auto-generated by LoganTerminal — do not edit.
# Chain the user's zshrc first so we don't shadow their config.
if [[ -r "$HOME/.zshrc" ]]; then
  ZDOTDIR="$HOME" source "$HOME/.zshrc"
fi

_logan_terminal_osc7() {
  local host="${HOST:-${HOSTNAME:-localhost}}"
  printf '\e]7;file://%s%s\a' "$host" "$PWD"
}

if [[ -n "${precmd_functions+set}" ]]; then
  precmd_functions+=(_logan_terminal_osc7)
else
  precmd_functions=(_logan_terminal_osc7)
fi

# Emit once on startup so consumers get an initial cwd.
_logan_terminal_osc7
"#;
    std::fs::write(&zshrc, contents)?;
    Ok(dir.to_string_lossy().into_owned())
}

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
}

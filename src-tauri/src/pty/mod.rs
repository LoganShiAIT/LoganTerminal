//! PTY session lifecycle: spawn a shell, stream its output to the frontend,
//! write input back, resize, and reap on exit.
//!
//! - [`osc`]        — the OSC sequences this side acts on (cwd, notifications).
//! - [`shell_init`] — the generated rc files that make a shell emit them.

mod osc;
mod shell_init;

use std::collections::HashMap;
use std::io::{Read, Write};

use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

use osc::{parse_notification, parse_osc7, OscBuf};
use shell_init::shell_base_name;

/// One read from the pty master. 8 KiB is comfortably above a terminal's
/// per-frame output, so a busy agent still drains in a few reads.
const READ_BUF_BYTES: usize = 8192;

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

        let pair = native_pty_system().openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        let cmd = build_shell_command(shell, cwd);
        let child = pair.slave.spawn_command(cmd)?;
        drop(pair.slave);

        let shell_pid = child.process_id();
        let reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;

        spawn_reader_thread(app, id.clone(), reader);

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

/// The shell to run and the environment it runs in, including the
/// shell-integration hooks (see [`shell_init`]) for the shells that have them.
fn build_shell_command(shell: Option<String>, cwd: Option<String>) -> CommandBuilder {
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
        shell_init::ensure_zsh_hook_dir().ok()
    } else {
        None
    };
    // bash gets the same OSC 7/133 integration via --rcfile. A login (-l)
    // bash would ignore --rcfile entirely, so the bash rc emulates the full
    // login + interactive startup sequence itself. Unix-only: a bash.exe on
    // Windows (Git Bash, WSL) may not resolve the Windows-style path we'd
    // hand it, so it keeps stock behavior there.
    #[cfg(unix)]
    if shell_base == "bash" {
        if let Ok(rc) = shell_init::ensure_bash_hook_file() {
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
    cmd
}

/// Pump one session's output: OSC sequences become app events/notifications,
/// everything else is emitted verbatim on `pty://data/<id>`. Ends by evicting
/// the session and emitting `pty://exit/<id>`.
fn spawn_reader_thread(app: AppHandle, id: String, mut reader: Box<dyn Read + Send>) {
    std::thread::spawn(move || {
        let mut buf = [0u8; READ_BUF_BYTES];
        let mut osc = OscBuf::default();
        // Bytes of a multi-byte UTF-8 character whose remainder is still in
        // the pipe — decoding it lossily now would emit U+FFFD, so it carries
        // over and prepends to the next chunk.
        let mut pending: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    for payload in osc.feed(&buf[..n]) {
                        if let Some(cwd) = parse_osc7(&payload) {
                            let _ = app.emit(&format!("pty://cwd/{}", id), cwd);
                            continue;
                        }
                        if let Some((title, body)) = parse_notification(&payload) {
                            let _ = app.notification().builder().title(title).body(body).show();
                        }
                    }
                    pending.extend_from_slice(&buf[..n]);
                    let keep = utf8_incomplete_tail_start(&pending);
                    let tail = pending.split_off(keep);
                    let data = String::from_utf8_lossy(&pending).into_owned();
                    pending = tail;
                    if !data.is_empty() && app.emit(&format!("pty://data/{}", id), data).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        // A tail still held back at EOF is genuinely truncated — flush it so
        // the last bytes aren't silently dropped.
        if !pending.is_empty() {
            let data = String::from_utf8_lossy(&pending).into_owned();
            let _ = app.emit(&format!("pty://data/{}", id), data);
        }
        app.state::<PtyManager>().remove(&id);
        let _ = app.emit(&format!("pty://exit/{}", id), ());
    });
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

/// Session ids become event-topic suffixes (`pty://data/<id>`), so only the
/// UUIDs the frontend generates are accepted — nothing that could reshape a
/// topic path.
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
    fn validates_requested_session_ids() {
        let id = uuid::Uuid::new_v4().to_string();
        assert_eq!(validate_session_id(id.clone()).unwrap(), id);
        assert!(validate_session_id("pty://bad/topic".to_string()).is_err());
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
}

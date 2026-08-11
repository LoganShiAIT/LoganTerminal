//! OSC (Operating System Command) parsing on the pty byte stream.
//!
//! Only the sequences the *backend* acts on live here — OSC 7 (cwd) and the
//! OSC 9/99/777 notification family, which become native toasts. Sequences
//! the terminal itself handles (OSC 0/2 titles, OSC 133 shell integration,
//! OSC 8 hyperlinks) pass straight through to xterm in the frontend.

/// Small streaming parser for OSC sequences. An OSC begins with `ESC ]` and
/// ends with either BEL (0x07) or ST (`ESC \`); payloads can straddle chunk
/// boundaries, so the state carries between [`OscBuf::feed`] calls.
#[derive(Default)]
pub struct OscBuf {
    inside: bool,
    saw_esc: bool,
    buf: Vec<u8>,
}

/// Beyond this an unterminated OSC is treated as junk rather than buffered
/// forever — a runaway emitter must not grow this Vec without bound.
const MAX_OSC_PAYLOAD: usize = 4096;

impl OscBuf {
    /// Feed one read's worth of bytes; returns every OSC payload that
    /// completed within it (without the `ESC ]` intro or the terminator).
    pub fn feed(&mut self, chunk: &[u8]) -> Vec<Vec<u8>> {
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
            } else if byte == 0x07 {
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
                if self.buf.len() >= MAX_OSC_PAYLOAD {
                    self.buf.clear();
                    self.inside = false;
                } else {
                    self.buf.push(byte);
                }
                i += 1;
            }
        }
        out
    }
}

/// Working directory out of an OSC 7 payload (`7;file://host/path`).
pub fn parse_osc7(payload: &[u8]) -> Option<String> {
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
pub fn parse_notification(payload: &[u8]) -> Option<(String, String)> {
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

#[cfg(test)]
mod tests {
    use super::*;

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
}

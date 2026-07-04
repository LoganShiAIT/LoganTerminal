import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";

/** `file://host/path` → decoded local path (host ignored), else null. */
export function fileUrlToPath(url: string): string | null {
  if (!/^file:\/\//i.test(url)) return null;
  const rest = url.slice("file://".length);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  let path = rest.slice(slash);
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep the raw form if percent-decoding fails
  }
  // file:///C:/… → C:/… on Windows-style URLs.
  if (/^\/[A-Za-z]:[/\\]/.test(path)) path = path.slice(1);
  return path;
}

/**
 * Open a link clicked in terminal output. Web-ish URLs go to the default
 * app; file:// gets *revealed* in the file manager rather than opened —
 * launching whatever app a path maps to from a mouse click is a footgun.
 * Everything else is deliberately ignored. Matches the opener plugin's
 * `default` permission set (open-url on default schemes + reveal).
 */
export function openTerminalLink(uri: string) {
  if (/^(https?|mailto|tel):/i.test(uri)) {
    openUrl(uri).catch((err) => console.warn("openUrl failed", err));
  } else if (/^file:\/\//i.test(uri)) {
    const path = fileUrlToPath(uri);
    if (path) {
      revealItemInDir(path).catch((err) =>
        console.warn("revealItemInDir failed", err),
      );
    }
  }
}

import { invoke } from "@tauri-apps/api/core";

let cachedHome: string | null = null;

export async function homeDir(): Promise<string> {
  if (cachedHome === null) {
    cachedHome = await invoke<string>("fs_home_dir");
  }
  return cachedHome;
}

/** Replace the home-dir prefix with `~` for compact display. */
export function tildify(path: string, home: string | null): string {
  if (!home) return path;
  const normHome = home.replace(/[/\\]+$/, "");
  if (path === normHome) return "~";
  if (path.startsWith(normHome + "/") || path.startsWith(normHome + "\\")) {
    return "~" + path.slice(normHome.length);
  }
  return path;
}

/** Separator used by a path — `\` only when the path is Windows-style. */
function sepOf(path: string): "/" | "\\" {
  return path.includes("\\") ? "\\" : "/";
}

/** Last path segment, handling both `/` and `\` separators. */
export function basename(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

export function joinPath(base: string, name: string): string {
  const sep = sepOf(base);
  return base.endsWith(sep) ? base + name : base + sep + name;
}

/**
 * Parent directory, staying at the filesystem root (`/` or `C:\`) once
 * reached — callers can detect the root via `parentOf(p) === p`.
 */
export function parentOf(path: string): string {
  const sep = sepOf(path);
  let trimmed = path;
  while (trimmed.length > 1 && trimmed.endsWith(sep)) {
    trimmed = trimmed.slice(0, -1);
  }
  const idx = trimmed.lastIndexOf(sep);
  if (sep === "\\") {
    // "C:\foo" -> "C:\"; "C:\" stays "C:\".
    if (idx <= 2) return trimmed.slice(0, trimmed.indexOf("\\") + 1);
    return trimmed.slice(0, idx);
  }
  if (idx <= 0) return "/";
  return trimmed.slice(0, idx);
}

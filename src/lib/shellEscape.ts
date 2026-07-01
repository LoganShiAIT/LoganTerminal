import { invoke } from "@tauri-apps/api/core";

export function posixShellEscape(s: string): string {
  if (/^[A-Za-z0-9_\/.\-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export async function shellEscapePaths(paths: string[]): Promise<string[]> {
  try {
    return await invoke<string[]>("shell_escape_paths", { paths });
  } catch {
    return paths.map(posixShellEscape);
  }
}

export async function shellEscapePath(path: string): Promise<string> {
  const [escaped] = await shellEscapePaths([path]);
  return escaped;
}

/**
 * Worktree task-name sanitizer — TS mirror of `sanitize_task` in
 * `src-tauri/src/git.rs`, used only for the live branch/path preview in the
 * worktree modal (the Rust side is authoritative at creation). Keep the
 * fixture tables in both test suites identical.
 */
export function sanitizeTask(name: string): string | null {
  let kept = "";
  let pendingSep = false;
  for (const ch of name.trim()) {
    if (/\s/.test(ch)) {
      pendingSep = true;
      continue;
    }
    if (pendingSep) {
      kept += "-";
      pendingSep = false;
    }
    if (/[\p{L}\p{N}._-]/u.test(ch)) kept += ch;
  }
  let collapsed = "";
  let last = "";
  for (const ch of kept) {
    if ((ch === "." || ch === "-") && ch === last) continue;
    collapsed += ch;
    last = ch;
  }
  const trimEdges = (s: string) => s.replace(/^[.-]+/, "").replace(/[.-]+$/, "");
  let base = trimEdges(collapsed);
  if (base.endsWith(".lock")) base = trimEdges(base.slice(0, -".lock".length));
  return base.length > 0 ? base : null;
}

/** Shape returned by the `git_worktree_list` backend command. */
export interface WorktreeEntry {
  path: string;
  branch: string | null;
  is_main: boolean;
}

/** Shape returned by the `git_worktree_add` backend command. */
export interface WorktreeCreated {
  path: string;
  branch: string;
}

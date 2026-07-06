/** Mirrors the serde shapes in src-tauri/src/git.rs (Phase 12). */

export interface GitDirty {
  added: number;
  modified: number;
  deleted: number;
}

/** `git_status` payload; the command returns null outside a repository. */
export interface GitStatusInfo {
  branch: string;
  dirty: GitDirty | null;
}

export interface DiffFile {
  path: string;
  /** null together with `deletions` null = binary file. */
  additions: number | null;
  deletions: number | null;
  untracked: boolean;
}

export interface DiffSummary {
  files: DiffFile[];
  /** Branch mode: the base branch the range diffs against. Working: null. */
  base: string | null;
}

/**
 * "working" = uncommitted changes vs HEAD (plus untracked files);
 * "branch" = commits ahead of the main worktree's branch (merge-base range).
 */
export type DiffMode = "working" | "branch";

export function dirtyTotal(d: GitDirty | null | undefined): number {
  return d ? d.added + d.modified + d.deleted : 0;
}

export type DiffLineKind = "add" | "del" | "hunk" | "meta" | "ctx";

/**
 * Classify one unified-diff line for rendering. Order matters: `+++`/`---`
 * file headers must win over the bare `+`/`-` change prefixes.
 */
export function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+++") || line.startsWith("---")) return "meta";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  if (
    /^(diff --git|index |new file|deleted file|old mode|new mode|similarity |rename |copy |Binary files|\\ No newline)/.test(
      line,
    )
  ) {
    return "meta";
  }
  return "ctx";
}

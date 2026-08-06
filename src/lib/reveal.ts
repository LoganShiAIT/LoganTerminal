import { basename, parentOf } from "./paths";

export interface RevealTarget {
  /** Directory the file tree should list. */
  dir: string;
  /** Entry to flash inside that listing, if any. */
  highlight: string | null;
}

/**
 * Where the file tree should go to "show" a path. Mirrors the tree's own
 * click semantics: a folder opens, a file lights up inside its parent.
 */
export function revealTarget(path: string, isDir: boolean): RevealTarget {
  if (isDir) return { dir: path, highlight: null };
  return { dir: parentOf(path), highlight: basename(path) };
}

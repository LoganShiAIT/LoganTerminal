import type { DiffFile } from "./git";

/**
 * The changed-file list as a folder tree.
 *
 * A flat list of repo-relative paths is unreadable once a change spans a few
 * directories — every row repeats the same `src/components/…` prefix and the
 * name that actually distinguishes it gets truncated away. Folding the paths
 * into a tree spends one row per directory and gives each file its own short
 * label; single-child directory chains collapse into one row (`src/lib/git`)
 * so the nesting never costs more rows than it earns.
 */

export interface TreeFileNode {
  kind: "file";
  /** Repo-relative path — the identity used for selection and patch loads. */
  path: string;
  /** Row label: the file name. */
  label: string;
  file: DiffFile;
}

export interface TreeDirNode {
  kind: "dir";
  /** Full path of the deepest folder this row stands for. */
  path: string;
  /** Row label, possibly a collapsed chain like `src/components/DiffPanel`. */
  label: string;
  children: TreeNode[];
  /** Totals over every file below, at any depth. Binaries count as 0. */
  additions: number;
  deletions: number;
  files: number;
}

export type TreeNode = TreeFileNode | TreeDirNode;

export interface TreeRow {
  node: TreeNode;
  depth: number;
}

interface Interim {
  dirs: Map<string, Interim>;
  files: DiffFile[];
}

function emptyDir(): Interim {
  return { dirs: new Map(), files: [] };
}

/** Byte-ish order, not `localeCompare` — stable across locales and engines. */
function byName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Split on both separators; git emits `/`, but a caller may not. */
function segments(path: string): string[] {
  return path.split(/[\\/]/).filter(Boolean);
}

function toNodes(dir: Interim, prefix: string): TreeNode[] {
  const out: TreeNode[] = [];
  for (const name of [...dir.dirs.keys()].sort(byName)) {
    out.push(toDirNode(name, dir.dirs.get(name)!, prefix));
  }
  const files = [...dir.files].sort((a, b) => byName(a.path, b.path));
  for (const file of files) {
    const parts = segments(file.path);
    out.push({
      kind: "file",
      path: file.path,
      label: parts[parts.length - 1] ?? file.path,
      file,
    });
  }
  return out;
}

function toDirNode(name: string, dir: Interim, prefix: string): TreeDirNode {
  // Collapse `a/ -> b/ -> c/` chains: a directory holding nothing but one
  // subdirectory is not worth a row of its own.
  let label = name;
  let path = prefix ? `${prefix}/${name}` : name;
  let cur = dir;
  while (cur.files.length === 0 && cur.dirs.size === 1) {
    const [childName, child] = [...cur.dirs.entries()][0];
    label = `${label}/${childName}`;
    path = `${path}/${childName}`;
    cur = child;
  }
  const children = toNodes(cur, path);
  let additions = 0;
  let deletions = 0;
  let files = 0;
  for (const child of children) {
    if (child.kind === "dir") {
      additions += child.additions;
      deletions += child.deletions;
      files += child.files;
    } else {
      additions += child.file.additions ?? 0;
      deletions += child.file.deletions ?? 0;
      files += 1;
    }
  }
  return { kind: "dir", path, label, children, additions, deletions, files };
}

/** Fold a flat diff summary into directory nodes, folders before files. */
export function buildDiffTree(files: DiffFile[]): TreeNode[] {
  const root = emptyDir();
  for (const file of files) {
    const parts = segments(file.path);
    if (parts.length === 0) continue;
    let cur = root;
    for (const part of parts.slice(0, -1)) {
      let next = cur.dirs.get(part);
      if (!next) {
        next = emptyDir();
        cur.dirs.set(part, next);
      }
      cur = next;
    }
    cur.files.push(file);
  }
  return toNodes(root, "");
}

/** Visible rows, depth-first, skipping the children of collapsed folders. */
export function flattenTree(
  nodes: TreeNode[],
  collapsed: ReadonlySet<string>,
  depth = 0,
): TreeRow[] {
  const rows: TreeRow[] = [];
  for (const node of nodes) {
    rows.push({ node, depth });
    if (node.kind === "dir" && !collapsed.has(node.path)) {
      rows.push(...flattenTree(node.children, collapsed, depth + 1));
    }
  }
  return rows;
}

/** Every directory path in the tree — the collapse-all target set. */
export function allDirPaths(nodes: TreeNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.kind !== "dir") continue;
    paths.push(node.path);
    paths.push(...allDirPaths(node.children));
  }
  return paths;
}

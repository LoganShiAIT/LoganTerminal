import { describe, expect, it } from "vitest";
import { allDirPaths, buildDiffTree, flattenTree, type TreeDirNode } from "./diffTree";
import type { DiffFile } from "./git";

const f = (path: string, additions = 1, deletions = 0): DiffFile => ({
  path,
  additions,
  deletions,
  untracked: false,
});

describe("buildDiffTree", () => {
  it("nests paths, sorts folders before files, and totals each folder", () => {
    const tree = buildDiffTree([
      f("README.md", 2, 1),
      f("src/lib/git.ts", 10, 3),
      f("src/App.tsx", 4, 0),
    ]);

    expect(tree.map((n) => n.label)).toEqual(["src", "README.md"]);
    const src = tree[0] as TreeDirNode;
    expect(src.kind).toBe("dir");
    expect(src.additions).toBe(14);
    expect(src.deletions).toBe(3);
    expect(src.files).toBe(2);
    // Folder first, then the file, each sorted by name.
    expect(src.children.map((n) => n.label)).toEqual(["lib", "App.tsx"]);
    expect(src.children[0].path).toBe("src/lib");
  });

  it("collapses single-child directory chains into one row", () => {
    const tree = buildDiffTree([f("a/b/c/deep.ts")]);
    expect(tree).toHaveLength(1);
    expect(tree[0].label).toBe("a/b/c");
    expect(tree[0].path).toBe("a/b/c");
    expect((tree[0] as TreeDirNode).children[0].label).toBe("deep.ts");
  });

  it("stops collapsing where a chain forks or carries a file", () => {
    const forked = buildDiffTree([f("a/b/one.ts"), f("a/c/two.ts")]);
    expect(forked[0].label).toBe("a");
    // A directory holding a file of its own keeps its own row.
    const withFile = buildDiffTree([f("a/keep.ts"), f("a/b/one.ts")]);
    expect(withFile[0].label).toBe("a");
    expect((withFile[0] as TreeDirNode).children.map((n) => n.label)).toEqual([
      "b",
      "keep.ts",
    ]);
  });

  it("treats binary files as zero-count and keeps them in the tree", () => {
    const tree = buildDiffTree([
      { path: "img/logo.png", additions: null, deletions: null, untracked: false },
    ]);
    const dir = tree[0] as TreeDirNode;
    expect(dir.additions).toBe(0);
    expect(dir.files).toBe(1);
    expect(dir.children[0].kind).toBe("file");
  });

  it("handles an empty summary and root-only files", () => {
    expect(buildDiffTree([])).toEqual([]);
    const roots = buildDiffTree([f("b.txt"), f("a.txt")]);
    expect(roots.map((n) => n.label)).toEqual(["a.txt", "b.txt"]);
  });
});

describe("flattenTree", () => {
  const tree = buildDiffTree([f("src/lib/git.ts"), f("src/App.tsx"), f("go.mod")]);

  it("walks depth-first with a depth per row", () => {
    const rows = flattenTree(tree, new Set());
    expect(rows.map((r) => [r.node.label, r.depth])).toEqual([
      ["src", 0],
      ["lib", 1],
      ["git.ts", 2],
      ["App.tsx", 1],
      ["go.mod", 0],
    ]);
  });

  it("hides the children of a collapsed folder but keeps the folder row", () => {
    const rows = flattenTree(tree, new Set(["src/lib"]));
    expect(rows.map((r) => r.node.label)).toEqual([
      "src",
      "lib",
      "App.tsx",
      "go.mod",
    ]);
    expect(flattenTree(tree, new Set(["src"])).map((r) => r.node.label)).toEqual([
      "src",
      "go.mod",
    ]);
  });

  it("lists every directory path for collapse-all", () => {
    expect(allDirPaths(tree)).toEqual(["src", "src/lib"]);
  });
});

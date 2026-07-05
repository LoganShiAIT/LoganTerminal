import { describe, it, expect } from "vitest";
import { tildify, basename, joinPath, parentOf } from "./paths";

describe("tildify", () => {
  it("collapses the home prefix to ~", () => {
    expect(tildify("/Users/bob/src", "/Users/bob")).toBe("~/src");
    expect(tildify("/Users/bob", "/Users/bob")).toBe("~");
  });

  it("normalizes trailing separators on the home path", () => {
    expect(tildify("/Users/bob/src", "/Users/bob/")).toBe("~/src");
    expect(tildify("C:\\Users\\bob\\src", "C:\\Users\\bob\\")).toBe("~\\src");
  });

  it("does not tildify sibling directories sharing the prefix", () => {
    expect(tildify("/Users/bobby", "/Users/bob")).toBe("/Users/bobby");
  });

  it("passes through when home is unknown", () => {
    expect(tildify("/anywhere", null)).toBe("/anywhere");
  });

  it("handles Windows separators", () => {
    expect(tildify("C:\\Users\\bob\\dl", "C:\\Users\\bob")).toBe("~\\dl");
  });
});

describe("basename", () => {
  it("returns the last segment for POSIX and Windows paths", () => {
    expect(basename("/a/b/c.txt")).toBe("c.txt");
    expect(basename("C:\\a\\b\\c.txt")).toBe("c.txt");
  });

  it("ignores trailing separators", () => {
    expect(basename("/a/b/")).toBe("b");
    expect(basename("C:\\a\\b\\")).toBe("b");
  });

  it("falls back to the input for all-separator paths", () => {
    expect(basename("/")).toBe("/");
  });
});

describe("joinPath", () => {
  it("joins with the base path's own separator", () => {
    expect(joinPath("/a/b", "c")).toBe("/a/b/c");
    expect(joinPath("C:\\a", "c")).toBe("C:\\a\\c");
  });

  it("does not double a trailing separator", () => {
    expect(joinPath("/a/b/", "c")).toBe("/a/b/c");
    expect(joinPath("C:\\a\\", "c")).toBe("C:\\a\\c");
  });
});

describe("parentOf", () => {
  it("walks up POSIX paths and stops at /", () => {
    expect(parentOf("/a/b/c")).toBe("/a/b");
    expect(parentOf("/a")).toBe("/");
    expect(parentOf("/")).toBe("/");
  });

  it("ignores trailing separators", () => {
    expect(parentOf("/a/b/")).toBe("/a");
  });

  it("walks up Windows paths and stops at the drive root", () => {
    expect(parentOf("C:\\a\\b")).toBe("C:\\a");
    expect(parentOf("C:\\a")).toBe("C:\\");
  });

  it("is a fixed point at the drive root so callers can detect it", () => {
    // Regression: this used to return "" for "C:\", breaking the
    // parentOf(p) === p root check promised in the doc comment.
    expect(parentOf("C:\\")).toBe("C:\\");
    expect(parentOf(parentOf("C:\\a"))).toBe("C:\\");
  });
});

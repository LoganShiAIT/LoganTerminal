import { describe, it, expect } from "vitest";
import { revealTarget } from "./reveal";

describe("revealTarget", () => {
  it("opens a folder directly, with nothing to highlight", () => {
    expect(revealTarget("/Users/logan/code/app", true)).toEqual({
      dir: "/Users/logan/code/app",
      highlight: null,
    });
  });

  it("opens a file's parent and highlights the file", () => {
    expect(revealTarget("/Users/logan/code/app/src/main.tsx", false)).toEqual({
      dir: "/Users/logan/code/app/src",
      highlight: "main.tsx",
    });
  });

  it("handles Windows paths", () => {
    expect(revealTarget("C:\\Users\\Logan\\app\\index.ts", false)).toEqual({
      dir: "C:\\Users\\Logan\\app",
      highlight: "index.ts",
    });
  });

  it("keeps a top-level file at the filesystem root", () => {
    expect(revealTarget("/notes.md", false)).toEqual({
      dir: "/",
      highlight: "notes.md",
    });
  });
});

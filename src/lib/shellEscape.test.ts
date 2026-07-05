import { describe, it, expect } from "vitest";
import { posixShellEscape, shellEscapePaths } from "./shellEscape";

describe("posixShellEscape", () => {
  it("leaves safe filename characters unquoted", () => {
    expect(posixShellEscape("/usr/local/bin/claude")).toBe(
      "/usr/local/bin/claude",
    );
    expect(posixShellEscape("file-name_2.txt")).toBe("file-name_2.txt");
  });

  it("single-quotes anything with spaces or specials", () => {
    expect(posixShellEscape("My File.png")).toBe("'My File.png'");
    expect(posixShellEscape("a$b")).toBe("'a$b'");
    expect(posixShellEscape("a;rm -rf")).toBe("'a;rm -rf'");
  });

  it("escapes embedded single quotes with the '\\'' dance", () => {
    expect(posixShellEscape("it's here")).toBe("'it'\\''s here'");
  });
});

describe("shellEscapePaths (outside Tauri)", () => {
  it("falls back to POSIX escaping when the backend command is unreachable", async () => {
    // In tests there is no Tauri IPC bridge, so invoke() throws and the
    // catch-path must take over — same behavior a broken webview would get.
    const out = await shellEscapePaths(["/plain/path", "with space"]);
    expect(out).toEqual(["/plain/path", "'with space'"]);
  });
});

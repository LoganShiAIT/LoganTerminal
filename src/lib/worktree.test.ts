import { describe, it, expect } from "vitest";
import { sanitizeTask } from "./worktree";

describe("sanitizeTask", () => {
  it("matches the Rust fixture table exactly", () => {
    // Keep identical to sanitize_task_fixture_table in src-tauri/src/git.rs.
    const cases: Array<[string, string | null]> = [
      ["Fix Login Flow", "Fix-Login-Flow"],
      ["  padded   name ", "padded-name"],
      ["wt/../etc", "wt.etc"],
      ["修复登录", "修复登录"],
      ["a--b..c", "a-b.c"],
      ["...task...", "task"],
      ["task.lock", "task"],
      ["-lead-trail-", "lead-trail"],
      ["@#$%", null],
      ["", null],
      ["   ", null],
    ];
    for (const [input, want] of cases) {
      expect(sanitizeTask(input), `input: ${JSON.stringify(input)}`).toBe(want);
    }
  });
});

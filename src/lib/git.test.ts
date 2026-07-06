import { describe, expect, it } from "vitest";
import { classifyDiffLine, dirtyTotal } from "./git";

describe("dirtyTotal", () => {
  it("sums the three buckets and treats null/undefined as clean", () => {
    expect(dirtyTotal({ added: 1, modified: 2, deleted: 3 })).toBe(6);
    expect(dirtyTotal({ added: 0, modified: 0, deleted: 0 })).toBe(0);
    expect(dirtyTotal(null)).toBe(0);
    expect(dirtyTotal(undefined)).toBe(0);
  });
});

describe("classifyDiffLine", () => {
  it("classifies every unified-diff line shape", () => {
    const cases: Array<[string, ReturnType<typeof classifyDiffLine>]> = [
      ["@@ -1,4 +1,6 @@ fn main()", "hunk"],
      ["+++ b/src/a.rs", "meta"], // file header beats the + prefix
      ["--- a/src/a.rs", "meta"],
      ["+added line", "add"],
      ["-removed line", "del"],
      ["+", "add"], // bare blank-line addition
      ["-", "del"],
      ["diff --git a/x b/x", "meta"],
      ["index 3d4f9a1..b2c8e77 100644", "meta"],
      ["new file mode 100644", "meta"],
      ["deleted file mode 100644", "meta"],
      ["old mode 100644", "meta"],
      ["new mode 100755", "meta"],
      ["Binary files /dev/null and b/img.png differ", "meta"],
      ["\\ No newline at end of file", "meta"],
      [" context line", "ctx"],
      ["", "ctx"],
    ];
    for (const [line, want] of cases) {
      expect(classifyDiffLine(line), JSON.stringify(line)).toBe(want);
    }
  });
});

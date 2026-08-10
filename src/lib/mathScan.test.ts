import { describe, it, expect } from "vitest";
import { findSegments, findLastMathBlock, joinRows } from "./mathScan";

describe("findSegments", () => {
  it("reports the column range including the delimiters", () => {
    const row = "so $x^2$ then";
    const [seg] = findSegments([row]);
    expect(row.slice(seg.start, seg.end)).toBe("$x^2$");
    expect(seg.value).toBe("x^2");
    expect(seg.display).toBe(false);
    expect(seg.row).toBe(0);
  });

  it("finds several spans on one row", () => {
    const segs = findSegments(["$a$ and $b$ and $c$"]);
    expect(segs).toHaveLength(3);
    expect(new Set(segs.map((s) => s.spanId)).size).toBe(3);
  });

  it("marks display math", () => {
    const [seg] = findSegments(["$$\\sum_i c_i$$"]);
    expect(seg.display).toBe(true);
    expect(seg.start).toBe(0);
  });

  it("ignores rows without math", () => {
    expect(findSegments(["$ ls -la /usr"])).toEqual([]);
    expect(findSegments(["plain output line"])).toEqual([]);
    expect(findSegments(["echo $HOME > out.txt"])).toEqual([]);
  });

  it("underlines a block whose delimiters sit on their own rows", () => {
    // The shape agents actually print — no single row holds a whole formula,
    // which is why a row-at-a-time scan found nothing here.
    const rows = ["目标函数：", "$$", "\\min_x c^T x", "$$", "其中 c 是成本"];
    const segs = findSegments(rows);
    expect(segs.map((s) => s.row)).toEqual([1, 2, 3]);
    expect(new Set(segs.map((s) => s.spanId)).size).toBe(1);
    // Every row of the block previews the complete formula.
    expect(segs.every((s) => s.value === "\\min_x c^T x")).toBe(true);
    expect(segs.every((s) => s.display)).toBe(true);
    expect(segs[0]).toMatchObject({ start: 0, end: 2 });
    expect(segs[2]).toMatchObject({ start: 0, end: 2 });
  });

  it("follows a formula across a soft wrap and undoes the break", () => {
    const segs = findSegments(["text $a +", "b$ tail"], [false, true]);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ row: 0, start: 5, end: 9 });
    expect(segs[1]).toMatchObject({ row: 1, start: 0, end: 2 });
    // Un-wrapped, so no stray newline lands inside the LaTeX.
    expect(segs[0].value).toBe("a +b");
  });

  it("emits nothing for rows that hold only the joining newline", () => {
    const segs = findSegments(["$$x", "", "", "y$$"]);
    expect(segs.map((s) => s.row)).toEqual([0, 3]);
  });

  it("drops a span that would swallow the screen", () => {
    const rows = ["\\[start", ...Array(20).fill("filler"), "end\\]"];
    expect(findSegments(rows)).toEqual([]);
  });
});

describe("joinRows", () => {
  it("records where each row starts", () => {
    const { text, starts } = joinRows(["ab", "cd", "ef"], [false, true, false]);
    expect(text).toBe("abcd\nef");
    expect(starts).toEqual([0, 2, 5]);
  });
});

describe("findLastMathBlock", () => {
  it("returns the paragraph around the newest formula", () => {
    const rows = [
      "some earlier text with $a$",
      "",
      "## Model",
      "$$\\min_x c^T x$$",
      "where $x$ is the decision vector",
      "",
      "unrelated trailing chatter",
    ];
    const block = findLastMathBlock(rows);
    expect(block).toBe(
      "## Model\n$$\\min_x c^T x$$\nwhere $x$ is the decision vector",
    );
  });

  it("picks up formulas that soft-wrapped across rows", () => {
    const block = findLastMathBlock(["$$a + b", "+ c$$"]);
    expect(block).toBe("$$a + b\n+ c$$");
  });

  it("rejoins a soft wrap when the buffer says the row is a continuation", () => {
    const block = findLastMathBlock(["$$a + b", "+ c$$"], [false, true]);
    expect(block).toBe("$$a + b+ c$$");
  });

  it("returns null when there is no math", () => {
    expect(findLastMathBlock(["ls -la", "total 24", ""])).toBeNull();
  });

  it("caps a runaway block", () => {
    const huge = "x".repeat(9000);
    const block = findLastMathBlock([`$a$ ${huge}`]);
    expect(block!.length).toBe(4000);
  });
});

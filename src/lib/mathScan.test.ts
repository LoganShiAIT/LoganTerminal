import { describe, it, expect } from "vitest";
import { findRowSpans, findLastMathBlock } from "./mathScan";

describe("findRowSpans", () => {
  it("reports the column range including the delimiters", () => {
    const row = "so $x^2$ then";
    const [span] = findRowSpans(row);
    expect(row.slice(span.start, span.end)).toBe("$x^2$");
    expect(span.value).toBe("x^2");
    expect(span.display).toBe(false);
  });

  it("finds several spans on one row", () => {
    expect(findRowSpans("$a$ and $b$ and $c$")).toHaveLength(3);
  });

  it("marks display math", () => {
    const [span] = findRowSpans("$$\\sum_i c_i$$");
    expect(span.display).toBe(true);
    expect(span.start).toBe(0);
  });

  it("ignores rows without math", () => {
    expect(findRowSpans("$ ls -la /usr")).toEqual([]);
    expect(findRowSpans("plain output line")).toEqual([]);
    expect(findRowSpans("echo $HOME > out.txt")).toEqual([]);
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

  it("returns null when there is no math", () => {
    expect(findLastMathBlock(["ls -la", "total 24", ""])).toBeNull();
  });

  it("caps a runaway block", () => {
    const huge = "x".repeat(9000);
    const block = findLastMathBlock([`$a$ ${huge}`]);
    expect(block!.length).toBe(4000);
  });
});

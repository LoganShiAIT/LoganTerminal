import { describe, it, expect } from "vitest";
import { fuzzyMatch } from "./fuzzy";

describe("fuzzyMatch", () => {
  it("matches every query char in order or returns null", () => {
    expect(fuzzyMatch("ct", "close tab")).not.toBeNull();
    expect(fuzzyMatch("tc", "close tab")).toBeNull(); // order matters
    expect(fuzzyMatch("xyz", "close tab")).toBeNull();
  });

  it("returns a zero-score match for an empty query", () => {
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0, indices: [] });
    expect(fuzzyMatch("   ", "anything")).toEqual({ score: 0, indices: [] });
  });

  it("is case-insensitive on both sides", () => {
    expect(fuzzyMatch("CT", "Close Tab")).not.toBeNull();
    expect(fuzzyMatch("ct", "CLOSE TAB")).not.toBeNull();
  });

  it("ignores spaces inside the query", () => {
    const spaced = fuzzyMatch("c t", "close tab");
    const compact = fuzzyMatch("ct", "close tab");
    expect(spaced).toEqual(compact);
  });

  it("reports match indices against the original target for highlighting", () => {
    expect(fuzzyMatch("ct", "close tab")?.indices).toEqual([0, 6]);
  });

  it("scores word-starts above consecutive runs above scattered hits", () => {
    // Targets isolate one scoring path each: both chars at word starts,
    // an in-word consecutive run, and two disconnected mid-word hits.
    const wordStart = fuzzyMatch("st", "split tab")!.score;
    const consecutive = fuzzyMatch("st", "paste")!.score;
    const scattered = fuzzyMatch("st", "us late")!.score;
    expect(wordStart).toBeGreaterThan(consecutive);
    expect(consecutive).toBeGreaterThan(scattered);
  });

  it("treats palette punctuation (— · - .) as word boundaries", () => {
    // Same match position, only the preceding char differs: after an
    // em dash / middle dot the word-start bonus applies, after a letter
    // it does not.
    expect(fuzzyMatch("t", "a—tab")!.score).toBeGreaterThan(
      fuzzyMatch("t", "amtab")!.score + 8,
    );
    expect(fuzzyMatch("b", "a·b")!.score).toBeGreaterThan(
      fuzzyMatch("b", "amb")!.score + 8,
    );
  });

  it("prefers the shorter target when matches are otherwise equal", () => {
    const short = fuzzyMatch("find", "find")!.score;
    const long = fuzzyMatch("find", "find in files")!.score;
    expect(short).toBeGreaterThan(long);
  });

  it("prefers an earlier first match", () => {
    const early = fuzzyMatch("z", "zoom pane")!.score;
    const late = fuzzyMatch("z", "toggle pane zzz")!.score;
    expect(early).toBeGreaterThan(late);
  });
});

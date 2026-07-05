import { describe, it, expect, beforeEach } from "vitest";
import { recentActionIds, recordAction, recencyBoost } from "./recency";

const KEY = "logan.paletteRecent";

beforeEach(() => localStorage.clear());

describe("recordAction / recentActionIds", () => {
  it("records newest-first", () => {
    recordAction("a");
    recordAction("b");
    expect(recentActionIds()).toEqual(["b", "a"]);
  });

  it("re-running an action moves it to the front without duplicating", () => {
    recordAction("a");
    recordAction("b");
    recordAction("a");
    expect(recentActionIds()).toEqual(["a", "b"]);
  });

  it("caps the list at 10", () => {
    for (let i = 0; i < 15; i++) recordAction(`id-${i}`);
    const ids = recentActionIds();
    expect(ids).toHaveLength(10);
    expect(ids[0]).toBe("id-14");
    expect(ids).not.toContain("id-4"); // oldest five dropped
  });

  it("survives malformed storage by returning an empty list", () => {
    localStorage.setItem(KEY, "not json {");
    expect(recentActionIds()).toEqual([]);
    localStorage.setItem(KEY, '{"a":1}'); // non-array JSON
    expect(recentActionIds()).toEqual([]);
  });

  it("filters non-string entries out of stored data", () => {
    localStorage.setItem(KEY, JSON.stringify(["a", 42, null, "b", {}]));
    expect(recentActionIds()).toEqual(["a", "b"]);
  });
});

describe("recencyBoost", () => {
  it("decays with rank and floors at zero", () => {
    const recent = ["r0", "r1", "r2", "r3", "r4", "r5"];
    expect(recencyBoost("r0", recent)).toBe(6);
    expect(recencyBoost("r1", recent)).toBe(4.5);
    expect(recencyBoost("r2", recent)).toBe(3);
    expect(recencyBoost("r3", recent)).toBe(1.5);
    expect(recencyBoost("r4", recent)).toBe(0);
    expect(recencyBoost("r5", recent)).toBe(0); // never negative
  });

  it("gives no boost to unknown ids", () => {
    expect(recencyBoost("missing", ["a"])).toBe(0);
  });

  it("stays below one fuzzy word-start hit so relevance dominates", () => {
    expect(recencyBoost("r0", ["r0"])).toBeLessThan(10);
  });
});

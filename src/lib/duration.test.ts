import { describe, it, expect } from "vitest";
import { formatDuration } from "./duration";

describe("formatDuration", () => {
  it("renders sub-second values as milliseconds", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(870)).toBe("870ms");
    expect(formatDuration(999.4)).toBe("999ms");
  });

  it("renders 1–10s with one decimal", () => {
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(4230)).toBe("4.2s");
    expect(formatDuration(9400)).toBe("9.4s");
  });

  it("renders 10–60s as whole seconds", () => {
    expect(formatDuration(10_000)).toBe("10s");
    expect(formatDuration(42_499)).toBe("42s");
    expect(formatDuration(59_400)).toBe("59s");
  });

  it("never produces a '1m 60s' artifact at the minute boundary", () => {
    // 59.6s rounds to 60 whole seconds, which must carry into the minutes.
    expect(formatDuration(59_600)).toBe("1m");
    expect(formatDuration(60_000)).toBe("1m");
    expect(formatDuration(60_400)).toBe("1m");
  });

  it("renders minutes with a seconds remainder only when nonzero", () => {
    expect(formatDuration(92_000)).toBe("1m 32s");
    expect(formatDuration(120_000)).toBe("2m");
  });

  it("renders hours with zero-padded minutes, dropping them when zero", () => {
    expect(formatDuration(3_600_000)).toBe("1h");
    expect(formatDuration(3_599_600)).toBe("1h"); // rounds up through 60m
    expect(formatDuration(3_900_000)).toBe("1h 05m");
    expect(formatDuration(7_620_000)).toBe("2h 07m");
  });
});

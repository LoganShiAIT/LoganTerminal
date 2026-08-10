import { describe, it, expect } from "vitest";
import { formatAgo, formatDuration } from "./duration";

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

describe("formatAgo", () => {
  // A fixed "now" so the fixtures don't depend on the wall clock.
  const now = 1_800_000_000_000;
  const ago = (seconds: number) => formatAgo(now / 1000 - seconds, now);

  it("picks the largest unit that fits", () => {
    expect(ago(0)).toBe("<1m");
    expect(ago(59)).toBe("<1m");
    expect(ago(60)).toBe("1m");
    expect(ago(3599)).toBe("59m");
    expect(ago(3600)).toBe("1h");
    expect(ago(86_400)).toBe("1d");
    expect(ago(604_800)).toBe("1w");
    expect(ago(2_592_000)).toBe("1mo");
    expect(ago(31_536_000)).toBe("1y");
    expect(ago(63_072_000)).toBe("2y");
  });

  it("reads a future timestamp as just now instead of a negative", () => {
    expect(ago(-5000)).toBe("<1m");
  });
});

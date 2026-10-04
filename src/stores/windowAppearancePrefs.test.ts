import { describe, expect, it } from "vitest";
import {
  normalizeBackgroundOpacity,
  normalizeWindowMaterial,
  DEFAULT_BG_OPACITY,
  MIN_BG_OPACITY,
  MAX_BG_OPACITY,
} from "./settingsStore";
import { computeSurfaceTokens, MIN_MODAL_ALPHA } from "../lib/surfacePolicy";
import { getTheme, withAlpha } from "../themes";

describe("normalizeWindowMaterial", () => {
  it("keeps glass, defaults everything else to solid", () => {
    expect(normalizeWindowMaterial("glass")).toBe("glass");
    expect(normalizeWindowMaterial("solid")).toBe("solid");
    expect(normalizeWindowMaterial(null)).toBe("solid");
    expect(normalizeWindowMaterial("mica")).toBe("solid");
    expect(normalizeWindowMaterial("")).toBe("solid");
  });
});

describe("normalizeBackgroundOpacity", () => {
  it("defaults missing and malformed values to 0.75", () => {
    expect(normalizeBackgroundOpacity(null)).toBe(DEFAULT_BG_OPACITY);
    expect(normalizeBackgroundOpacity("")).toBe(DEFAULT_BG_OPACITY);
    expect(normalizeBackgroundOpacity("abc")).toBe(DEFAULT_BG_OPACITY);
    expect(normalizeBackgroundOpacity("NaN")).toBe(DEFAULT_BG_OPACITY);
    expect(normalizeBackgroundOpacity("Infinity")).toBe(DEFAULT_BG_OPACITY);
  });

  it("clamps finite out-of-range values to 0.10–1.00", () => {
    expect(normalizeBackgroundOpacity("0.05")).toBe(MIN_BG_OPACITY);
    expect(normalizeBackgroundOpacity("-5")).toBe(MIN_BG_OPACITY);
    expect(normalizeBackgroundOpacity("1.7")).toBe(MAX_BG_OPACITY);
    expect(normalizeBackgroundOpacity("0.6")).toBe(0.6);
  });

  it("keeps in-range values below the old 0.40 floor untouched", () => {
    expect(normalizeBackgroundOpacity("0.1")).toBe(0.1);
    expect(normalizeBackgroundOpacity("0.3")).toBe(0.3);
  });
});

describe("computeSurfaceTokens", () => {
  const theme = getTheme("warm-dark");

  it("is fully opaque in solid mode", () => {
    const tokens = computeSurfaceTokens(theme, "solid", 0.4);
    expect(tokens.shell).toBe(theme.ui.panel);
    expect(tokens.terminal).toBe(theme.ui.panel);
    expect(tokens.modal).toBe(theme.ui.raise);
    expect(tokens.reader).toBe(theme.ui.panel);
  });

  it("applies the user opacity to shell and terminal in glass mode", () => {
    const tokens = computeSurfaceTokens(theme, "glass", 0.6);
    expect(tokens.shell).toBe(withAlpha(theme.ui.panel, 0.6));
    expect(tokens.terminal).toBe(withAlpha(theme.ui.panel, 0.6));
    // Reading surfaces never follow the glass opacity.
    expect(tokens.reader).toBe(theme.ui.panel);
  });

  it("is opaque at 100% without reporting a failure", () => {
    const tokens = computeSurfaceTokens(theme, "glass", 1);
    expect(tokens.shell).toBe(withAlpha(theme.ui.panel, 1));
    expect(tokens.terminal).toBe(withAlpha(theme.ui.panel, 1));
  });

  it("clamps out-of-range opacity instead of emitting invalid alpha", () => {
    const low = computeSurfaceTokens(theme, "glass", 0.05);
    expect(low.shell).toBe(withAlpha(theme.ui.panel, MIN_BG_OPACITY));
    const high = computeSurfaceTokens(theme, "glass", 4);
    expect(high.shell).toBe(withAlpha(theme.ui.panel, MAX_BG_OPACITY));
  });

  it("keeps modal surfaces at or above 92% even at minimum glass opacity", () => {
    const tokens = computeSurfaceTokens(theme, "glass", MIN_BG_OPACITY);
    expect(tokens.modal).toBe(withAlpha(theme.ui.raise, MIN_MODAL_ALPHA));
  });
});

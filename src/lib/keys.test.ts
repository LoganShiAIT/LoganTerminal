import { describe, it, expect, vi } from "vitest";

/**
 * keys.ts captures `isMac` from navigator.userAgent at module load, so each
 * case re-imports the module under a stubbed UA.
 */
async function kbdWithUA(ua: string) {
  vi.resetModules();
  Object.defineProperty(window.navigator, "userAgent", {
    value: ua,
    configurable: true,
  });
  return (await import("./keys")).kbd;
}

const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const WIN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

describe("kbd", () => {
  it("returns Mac glyph hints untouched on Mac", async () => {
    const kbd = await kbdWithUA(MAC_UA);
    expect(kbd("⌘⇧D")).toBe("⌘⇧D");
    expect(kbd("⌘,")).toBe("⌘,");
  });

  it("maps modifier glyphs to Ctrl/Shift/Alt words elsewhere", async () => {
    const kbd = await kbdWithUA(WIN_UA);
    expect(kbd("⌘D")).toBe("Ctrl+D");
    expect(kbd("⌘⇧D")).toBe("Ctrl+Shift+D");
    expect(kbd("⌘⌥I")).toBe("Ctrl+Alt+I");
    expect(kbd("⌃C")).toBe("Ctrl+C");
  });

  it("keeps non-modifier characters as the chord tail", async () => {
    const kbd = await kbdWithUA(WIN_UA);
    expect(kbd("⌘,")).toBe("Ctrl+,");
    expect(kbd("⌘1")).toBe("Ctrl+1");
    expect(kbd("⌘↑")).toBe("Ctrl+↑");
  });

  it("passes through hints with no modifiers", async () => {
    const kbd = await kbdWithUA(WIN_UA);
    expect(kbd("F5")).toBe("F5");
  });

  it("keeps multi-char tails intact", async () => {
    const kbd = await kbdWithUA(WIN_UA);
    expect(kbd("⌘⇧[")).toBe("Ctrl+Shift+[");
    expect(kbd("⌥Esc")).toBe("Alt+Esc");
  });
});

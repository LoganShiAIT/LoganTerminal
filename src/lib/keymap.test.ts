import { describe, it, expect, vi } from "vitest";
import type { Binding } from "./keymap";

/**
 * keymap.ts pulls in keys.ts, which captures `isMac` from navigator.userAgent
 * at module load — so each platform's cases re-import under a stubbed UA.
 */
async function matcherFor(ua: string) {
  vi.resetModules();
  Object.defineProperty(window.navigator, "userAgent", {
    value: ua,
    configurable: true,
  });
  return (await import("./keymap")).matchBinding;
}

const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const WIN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

const noop = () => {};
const key = (k: string, extra: Partial<KeyboardEvent> = {}) =>
  ({
    key: k,
    code: `Key${k.toUpperCase()}`,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...extra,
  }) as KeyboardEvent;

const BINDINGS: Binding[] = [
  { key: "t", shift: false, run: noop },
  { key: "w", shift: true, run: noop },
  { key: "b", run: noop },
  { code: "KeyI", alt: true, run: noop },
  { match: (k) => /^[1-9]$/.test(k), run: noop },
];

describe("matchBinding on Mac", () => {
  it("requires ⌘ and ignores plain Ctrl, which belongs to the shell", async () => {
    const match = await matcherFor(MAC_UA);
    expect(match(BINDINGS, key("t", { metaKey: true }))).toBe(BINDINGS[0]);
    expect(match(BINDINGS, key("t", { ctrlKey: true }))).toBeUndefined();
    // ⌃⌘ is not the app modifier either.
    expect(
      match(BINDINGS, key("t", { metaKey: true, ctrlKey: true })),
    ).toBeUndefined();
    expect(match(BINDINGS, key("t"))).toBeUndefined();
  });
});

describe("matchBinding elsewhere", () => {
  it("uses Ctrl as the app modifier", async () => {
    const match = await matcherFor(WIN_UA);
    expect(match(BINDINGS, key("t", { ctrlKey: true }))).toBe(BINDINGS[0]);
    expect(match(BINDINGS, key("t", { metaKey: true }))).toBeUndefined();
  });

  it("leaves AltGr chords (reported as Ctrl+Alt) to the keyboard layout", async () => {
    const match = await matcherFor(WIN_UA);
    expect(
      match(BINDINGS, key("t", { ctrlKey: true, altKey: true })),
    ).toBeUndefined();
    expect(
      match(BINDINGS, key("2", { ctrlKey: true, altKey: true })),
    ).toBeUndefined();
  });
});

describe("matchBinding shape matching", () => {
  it("honours the required Shift state, and matches keys case-insensitively", async () => {
    const match = await matcherFor(MAC_UA);
    const mod = { metaKey: true };
    // "w" is Shift-only; Shift turns e.key into "W".
    expect(match(BINDINGS, key("W", { ...mod, shiftKey: true }))).toBe(
      BINDINGS[1],
    );
    expect(match(BINDINGS, key("w", { ...mod }))).toBeUndefined();
    // "t" is explicitly no-Shift.
    expect(
      match(BINDINGS, key("T", { ...mod, shiftKey: true })),
    ).toBeUndefined();
    // "b" does not care either way.
    expect(match(BINDINGS, key("b", { ...mod }))).toBe(BINDINGS[2]);
    expect(match(BINDINGS, key("B", { ...mod, shiftKey: true }))).toBe(
      BINDINGS[2],
    );
  });

  it("matches ⌥ chords by physical code — ⌥ composes dead keys on macOS", async () => {
    const match = await matcherFor(MAC_UA);
    const alt = { metaKey: true, altKey: true };
    // ⌥I arrives as "ı", never a plain "i".
    expect(match(BINDINGS, key("ı", { ...alt, code: "KeyI" }))).toBe(
      BINDINGS[3],
    );
    // Without ⌥ held, the same physical key must not fire it.
    expect(
      match(BINDINGS, key("i", { metaKey: true, code: "KeyI" })),
    ).toBeUndefined();
  });

  it("supports key families via match()", async () => {
    const match = await matcherFor(MAC_UA);
    expect(match(BINDINGS, key("1", { metaKey: true }))).toBe(BINDINGS[4]);
    expect(match(BINDINGS, key("9", { metaKey: true }))).toBe(BINDINGS[4]);
    expect(match(BINDINGS, key("0", { metaKey: true }))).toBeUndefined();
  });

  it("returns the first match when several bindings could apply", async () => {
    const match = await matcherFor(MAC_UA);
    const first: Binding = { key: "x", run: noop };
    const second: Binding = { key: "x", shift: false, run: noop };
    expect(match([first, second], key("x", { metaKey: true }))).toBe(first);
  });
});

/**
 * Platform-aware keyboard handling: the single source of truth for "is this
 * a Mac" and "did the user press the app modifier", plus the hint labels
 * that must mirror it.
 */
export const isMac = navigator.userAgent.includes("Mac");

/**
 * True when the event carries the app's own modifier.
 *
 * Mac: ⌘ only, and never with Ctrl held — plain Ctrl must reach the shell
 * untouched (Ctrl+D EOF, Ctrl+K kill-line, Ctrl+T transpose). Everywhere
 * else Ctrl is the app modifier.
 */
export function hasAppMod(e: KeyboardEvent): boolean {
  return isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey;
}

/**
 * Hint labels are written in Mac glyph form ("⌘⇧D") throughout the app; on
 * Windows/Linux they render as "Ctrl+Shift+D", since ⌘ means nothing on
 * those keyboards.
 */
const MODS: Record<string, string> = {
  "⌘": "Ctrl",
  "⌃": "Ctrl",
  "⇧": "Shift",
  "⌥": "Alt",
};

export function kbd(macHint: string): string {
  if (isMac) return macHint;
  const mods: string[] = [];
  let rest = "";
  for (const ch of macHint) {
    const mapped = MODS[ch];
    if (mapped) mods.push(mapped);
    else rest += ch;
  }
  return [...mods, rest].filter(Boolean).join("+");
}

/**
 * Platform-aware keyboard hint labels. Hints are written in Mac glyph form
 * ("⌘⇧D") throughout the app; on Windows/Linux they render as
 * "Ctrl+Shift+D", since ⌘ means nothing on those keyboards. Mirrors the
 * actual key handling, which maps the app modifier to metaKey on Mac and
 * ctrlKey elsewhere.
 */
const isMac = navigator.userAgent.includes("Mac");

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

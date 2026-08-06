import { hasAppMod } from "./keys";

/**
 * One app-level keyboard shortcut. Every binding implicitly requires the app
 * modifier (⌘ on Mac, Ctrl elsewhere — see [`hasAppMod`]); the fields below
 * only describe what comes *on top* of it.
 */
export interface Binding {
  /**
   * Logical key, compared case-insensitively against `e.key` — so a binding
   * written as "w" also matches the "W" that Shift produces.
   */
  key?: string;
  /**
   * Physical key, compared against `e.code`. Use this instead of `key` when
   * ⌥ is part of the chord: on macOS ⌥ composes dead keys, so ⌥I arrives as
   * `e.key === "ı"` and never as a plain "i".
   */
  code?: string;
  /** Matches `e.key` freely — for families like the arrow keys. */
  match?: (key: string) => boolean;
  /** Required Shift state; `undefined` = either is fine. */
  shift?: boolean;
  /** Required Alt state; defaults to "not held". */
  alt?: boolean;
  /** Send focus back to the terminal on the next frame after running. */
  refocus?: boolean;
  run: (e: KeyboardEvent) => void;
}

/**
 * First binding in `bindings` that `e` satisfies, or undefined.
 *
 * Alt defaults to *must not be held* so a Windows AltGr chord (which the OS
 * reports as Ctrl+Alt) types its character instead of firing an unrelated
 * app shortcut.
 */
export function matchBinding(
  bindings: Binding[],
  e: KeyboardEvent,
): Binding | undefined {
  if (!hasAppMod(e)) return undefined;
  return bindings.find((b) => {
    if (b.shift !== undefined && b.shift !== e.shiftKey) return false;
    if ((b.alt ?? false) !== e.altKey) return false;
    if (b.code !== undefined) return b.code === e.code;
    if (b.match !== undefined) return b.match(e.key);
    if (b.key !== undefined) {
      return b.key.toLowerCase() === e.key.toLowerCase();
    }
    return false;
  });
}

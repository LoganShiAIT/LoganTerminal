/**
 * Tiny window-event bridge so chrome UI (command palette, header, asset
 * panel) can drive the active xterm instance, which lives inside the
 * Terminal component.
 */
export type SimpleTermCmd =
  | "clear"
  | "find"
  | "scroll-bottom"
  | "focus"
  | "prompt-prev"
  | "prompt-next"
  | "select-output";

/**
 * `paste` routes text through xterm's term.paste() — newline normalization
 * plus bracketed-paste wrapping — instead of a raw pty write, which would
 * execute multi-line text line-by-line the moment it lands.
 */
export type TermCmd = SimpleTermCmd | { kind: "paste"; text: string };

export const TERM_CMD_EVENT = "logan:term-cmd";

export function sendTermCmd(cmd: TermCmd) {
  window.dispatchEvent(new CustomEvent<TermCmd>(TERM_CMD_EVENT, { detail: cmd }));
}

export function onTermCmd(handler: (cmd: TermCmd) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<TermCmd>).detail);
  window.addEventListener(TERM_CMD_EVENT, listener);
  return () => window.removeEventListener(TERM_CMD_EVENT, listener);
}

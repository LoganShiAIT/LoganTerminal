/**
 * Tiny window-event bridge so chrome UI (command palette, header) can drive
 * the active xterm instance, which lives inside the Terminal component.
 */
export type TermCmd =
  | "clear"
  | "find"
  | "scroll-bottom"
  | "focus"
  | "prompt-prev"
  | "prompt-next";

export const TERM_CMD_EVENT = "logan:term-cmd";

export function sendTermCmd(cmd: TermCmd) {
  window.dispatchEvent(new CustomEvent<TermCmd>(TERM_CMD_EVENT, { detail: cmd }));
}

export function onTermCmd(handler: (cmd: TermCmd) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<TermCmd>).detail);
  window.addEventListener(TERM_CMD_EVENT, listener);
  return () => window.removeEventListener(TERM_CMD_EVENT, listener);
}

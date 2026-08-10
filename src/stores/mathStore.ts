import { create } from "zustand";

const KEY = "logan.mathSource";
const MAX_SOURCE = 200_000;

export type MathOrigin = "selection" | "output" | "manual" | "auto";

interface MathStore {
  /** Markdown + LaTeX being previewed. */
  source: string;
  /** Where the current source came from, for the panel's status line. */
  origin: MathOrigin;
  /**
   * Auto-follow is paused because this session's user typed in the editor.
   * Deliberately session-scoped and never persisted: `origin` is restored as
   * `manual` at every startup, so gating on it left auto-follow permanently
   * off for anyone who had ever put something in the panel.
   */
  manualHold: boolean;
  setSource: (source: string, origin: MathOrigin) => void;
  /**
   * Push freshly-printed terminal math in. Yields to a scratch being hand-
   * edited right now: silently overwriting what someone is typing is the kind
   * of "helpful" that loses work.
   */
  autoFollow: (source: string) => void;
  clear: () => void;
}

function load(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * The scratch survives restarts — a formula you were mid-way through
 * rewriting for a paper is worth more than a clean slate. It is shown again,
 * but it does not hold auto-follow hostage: the next formula the terminal
 * prints takes the panel back.
 */
export const useMathStore = create<MathStore>((set) => ({
  source: load(),
  origin: "manual",
  manualHold: false,
  setSource: (source, origin) =>
    set({
      source: source.slice(0, MAX_SOURCE),
      origin,
      manualHold: origin === "manual" && source.trim() !== "",
    }),
  autoFollow: (source) =>
    set((s) => {
      if (s.manualHold) return s;
      const next = source.slice(0, MAX_SOURCE);
      if (next === s.source && s.origin === "auto") return s;
      return { source: next, origin: "auto" };
    }),
  clear: () => set({ source: "", origin: "manual", manualHold: false }),
}));

useMathStore.subscribe((state) => {
  try {
    localStorage.setItem(KEY, state.source);
  } catch {
    // Persistence is best-effort.
  }
});

export interface MathHover {
  /** Rendered KaTeX HTML. */
  html: string;
  /** Viewport rect of the underlined span the popover points at. */
  anchor: { left: number; top: number; right: number; bottom: number };
}

interface MathHoverStore {
  hover: MathHover | null;
  show: (hover: MathHover) => void;
  hide: () => void;
}

/** Separate from the panel store: this changes on every mouse move over a
 *  formula and must not re-render the panel. */
export const useMathHoverStore = create<MathHoverStore>((set) => ({
  hover: null,
  show: (hover) => set({ hover }),
  hide: () => set({ hover: null }),
}));

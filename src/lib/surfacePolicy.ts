import { withAlpha, type Theme } from "../themes";
import {
  MIN_BG_OPACITY,
  MAX_BG_OPACITY,
  type WindowMaterial,
} from "../stores/settingsStore";

/** What the window actually shows right now — the preference may differ. */
export type EffectiveMode = WindowMaterial;

/**
 * Interactive overlays (settings, palette, finder, …) must stay readable over
 * any desktop background, so their surface never goes below this alpha.
 */
export const MIN_MODAL_ALPHA = 0.92;

export interface SurfaceTokens {
  /** Header, sidebar, tab strip — one tint per region, no stacked layers. */
  shell: string;
  /** Each terminal pane's single base tint (xterm itself stays transparent). */
  terminal: string;
  /** Overlay cards; ≥ MIN_MODAL_ALPHA even at the lowest glass opacity. */
  modal: string;
  /** Reading surfaces never follow the glass opacity. */
  reader: string;
}

/**
 * Derive the per-region base backgrounds from theme + effective mode +
 * opacity. Solid (user choice or native fallback) is always fully opaque;
 * glass at opacity 1.00 is opaque too, which correctly hides the material.
 */
export function computeSurfaceTokens(
  theme: Theme,
  mode: EffectiveMode,
  opacity: number,
): SurfaceTokens {
  if (mode === "solid") {
    return {
      shell: theme.ui.panel,
      terminal: theme.ui.panel,
      modal: theme.ui.raise,
      reader: theme.ui.panel,
    };
  }
  const a = Math.min(MAX_BG_OPACITY, Math.max(MIN_BG_OPACITY, opacity));
  return {
    shell: withAlpha(theme.ui.panel, a),
    terminal: withAlpha(theme.ui.panel, a),
    modal: withAlpha(theme.ui.raise, Math.max(MIN_MODAL_ALPHA, a)),
    reader: theme.ui.panel,
  };
}

/**
 * Push the tokens onto :root and flag the mode for CSS (`data-material`).
 * Pure DOM work — no native calls — so opacity slider movement lands here
 * only, never in the window material layer.
 */
export function applySurfaceTokens(
  theme: Theme,
  mode: EffectiveMode,
  opacity: number,
) {
  const tokens = computeSurfaceTokens(theme, mode, opacity);
  const root = document.documentElement;
  root.style.setProperty("--surface-shell", tokens.shell);
  root.style.setProperty("--surface-terminal", tokens.terminal);
  root.style.setProperty("--surface-modal", tokens.modal);
  root.style.setProperty("--surface-reader", tokens.reader);
  root.dataset.material = mode;
}

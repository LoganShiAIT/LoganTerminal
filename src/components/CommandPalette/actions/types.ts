import { usePtyStore } from "../../../stores/ptyStore";
import { useSettingsStore } from "../../../stores/settingsStore";
import { useUiStore } from "../../../stores/uiStore";

export interface PaletteAction {
  id: string;
  group: string;
  label: string;
  /** Keyboard hint rendered as a kbd chip. */
  hint?: string;
  /** Small color swatch (themes / accents). */
  swatch?: string;
  /** Marks the currently-active choice with a dot. */
  active?: boolean;
  /** Skip refocusing the terminal after running (action manages focus). */
  keepFocus?: boolean;
  /** Excluded from recent-command tracking (id embeds an ephemeral uuid). */
  transient?: boolean;
  run: () => void;
}

/**
 * Store accessors for action bodies. An action `run` fires long after the
 * palette rendered, so it must read state at call time rather than close over
 * a render-time snapshot.
 */
export const pty = () => usePtyStore.getState();
export const ui = () => useUiStore.getState();
export const settings = () => useSettingsStore.getState();

import { create } from "zustand";
import { applyTheme, getTheme } from "../themes";

export const MIN_FONT_SIZE = 9;
export const MAX_FONT_SIZE = 28;
export const DEFAULT_FONT_SIZE = 13;

const FONT_SIZE_KEY = "logan.fontSize";
const SHOW_HIDDEN_KEY = "logan.showHiddenFiles";
const THEME_KEY = "logan.theme";
const ACCENT_KEY = "logan.accent";

function loadFontSize(): number {
  const raw = localStorage.getItem(FONT_SIZE_KEY);
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n)
    ? Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, n))
    : DEFAULT_FONT_SIZE;
}

function loadThemeId(): string {
  // getTheme falls back to the default for unknown/stale ids.
  return getTheme(localStorage.getItem(THEME_KEY)).id;
}

function loadAccent(): string | null {
  const raw = localStorage.getItem(ACCENT_KEY);
  return raw && /^#[0-9a-f]{6}$/i.test(raw) ? raw : null;
}

interface SettingsStore {
  fontSize: number;
  showHiddenFiles: boolean;
  themeId: string;
  /** Accent color overriding the theme's own; null = theme default. */
  accentOverride: string | null;
  /** Settings panel visibility — UI state, not persisted. */
  panelOpen: boolean;
  bumpFontSize: (delta: number) => void;
  resetFontSize: () => void;
  toggleHiddenFiles: () => void;
  setTheme: (id: string) => void;
  setAccentOverride: (color: string | null) => void;
  setPanelOpen: (open: boolean) => void;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  fontSize: loadFontSize(),
  showHiddenFiles: localStorage.getItem(SHOW_HIDDEN_KEY) === "1",
  themeId: loadThemeId(),
  accentOverride: loadAccent(),
  panelOpen: false,
  bumpFontSize: (delta) => {
    const next = Math.max(
      MIN_FONT_SIZE,
      Math.min(MAX_FONT_SIZE, get().fontSize + delta),
    );
    localStorage.setItem(FONT_SIZE_KEY, String(next));
    set({ fontSize: next });
  },
  resetFontSize: () => {
    localStorage.setItem(FONT_SIZE_KEY, String(DEFAULT_FONT_SIZE));
    set({ fontSize: DEFAULT_FONT_SIZE });
  },
  toggleHiddenFiles: () => {
    const next = !get().showHiddenFiles;
    localStorage.setItem(SHOW_HIDDEN_KEY, next ? "1" : "0");
    set({ showHiddenFiles: next });
  },
  setTheme: (id) => {
    const theme = getTheme(id);
    localStorage.setItem(THEME_KEY, theme.id);
    set({ themeId: theme.id });
    applyTheme(theme, get().accentOverride);
  },
  setAccentOverride: (color) => {
    if (color) localStorage.setItem(ACCENT_KEY, color);
    else localStorage.removeItem(ACCENT_KEY);
    set({ accentOverride: color });
    applyTheme(getTheme(get().themeId), color);
  },
  setPanelOpen: (open) => set({ panelOpen: open }),
}));

// Apply the persisted theme before first render (module runs pre-mount).
{
  const s = useSettingsStore.getState();
  applyTheme(getTheme(s.themeId), s.accentOverride);
}

import { create } from "zustand";
import { applyTheme, getTheme } from "../themes";

export const MIN_FONT_SIZE = 9;
export const MAX_FONT_SIZE = 28;
export const DEFAULT_FONT_SIZE = 13;

export type CursorStyle = "block" | "bar" | "underline";

const FONT_SIZE_KEY = "logan.fontSize";
const SHOW_HIDDEN_KEY = "logan.showHiddenFiles";
const THEME_KEY = "logan.theme";
const ACCENT_KEY = "logan.accent";
const CURSOR_STYLE_KEY = "logan.cursorStyle";
const CURSOR_BLINK_KEY = "logan.cursorBlink";
const AMBIENT_KEY = "logan.ambientMotion";
const CRT_KEY = "logan.crt";
const NOTIFY_LONG_KEY = "logan.notifyLongCmds";
const NOTIFY_BELL_KEY = "logan.notifyBell";

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

function loadCursorStyle(): CursorStyle {
  const raw = localStorage.getItem(CURSOR_STYLE_KEY);
  return raw === "bar" || raw === "underline" ? raw : "block";
}

function loadBool(key: string, fallback: boolean): boolean {
  const raw = localStorage.getItem(key);
  return raw === null ? fallback : raw === "1";
}

/** The grid-drift animation is pure CSS, keyed off this html attribute. */
function applyAmbientAttr(on: boolean) {
  document.documentElement.dataset.ambient = on ? "1" : "0";
}

interface SettingsStore {
  fontSize: number;
  showHiddenFiles: boolean;
  themeId: string;
  /** Accent color overriding the theme's own; null = theme default. */
  accentOverride: string | null;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  /** Drifting grid + floating glow orbs behind the chrome. */
  ambientMotion: boolean;
  /** Retro scanline overlay on the terminal area. */
  crtMode: boolean;
  /** Desktop toast when a long command finishes out of view (OSC 133). */
  notifyLongCommands: boolean;
  /** Desktop toast when a terminal bell rings out of view (agent prompts). */
  notifyBell: boolean;
  /** Settings panel visibility — UI state, not persisted. */
  panelOpen: boolean;
  bumpFontSize: (delta: number) => void;
  resetFontSize: () => void;
  toggleHiddenFiles: () => void;
  setTheme: (id: string) => void;
  setAccentOverride: (color: string | null) => void;
  setCursorStyle: (style: CursorStyle) => void;
  toggleCursorBlink: () => void;
  toggleAmbientMotion: () => void;
  toggleCrtMode: () => void;
  toggleNotifyLongCommands: () => void;
  toggleNotifyBell: () => void;
  setPanelOpen: (open: boolean) => void;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  fontSize: loadFontSize(),
  showHiddenFiles: localStorage.getItem(SHOW_HIDDEN_KEY) === "1",
  themeId: loadThemeId(),
  accentOverride: loadAccent(),
  cursorStyle: loadCursorStyle(),
  cursorBlink: loadBool(CURSOR_BLINK_KEY, true),
  ambientMotion: loadBool(AMBIENT_KEY, true),
  crtMode: loadBool(CRT_KEY, false),
  notifyLongCommands: loadBool(NOTIFY_LONG_KEY, true),
  notifyBell: loadBool(NOTIFY_BELL_KEY, true),
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
  setCursorStyle: (style) => {
    localStorage.setItem(CURSOR_STYLE_KEY, style);
    set({ cursorStyle: style });
  },
  toggleCursorBlink: () => {
    const next = !get().cursorBlink;
    localStorage.setItem(CURSOR_BLINK_KEY, next ? "1" : "0");
    set({ cursorBlink: next });
  },
  toggleAmbientMotion: () => {
    const next = !get().ambientMotion;
    localStorage.setItem(AMBIENT_KEY, next ? "1" : "0");
    applyAmbientAttr(next);
    set({ ambientMotion: next });
  },
  toggleCrtMode: () => {
    const next = !get().crtMode;
    localStorage.setItem(CRT_KEY, next ? "1" : "0");
    set({ crtMode: next });
  },
  toggleNotifyLongCommands: () => {
    const next = !get().notifyLongCommands;
    localStorage.setItem(NOTIFY_LONG_KEY, next ? "1" : "0");
    set({ notifyLongCommands: next });
  },
  toggleNotifyBell: () => {
    const next = !get().notifyBell;
    localStorage.setItem(NOTIFY_BELL_KEY, next ? "1" : "0");
    set({ notifyBell: next });
  },
  setPanelOpen: (open) => set({ panelOpen: open }),
}));

// Apply the persisted theme before first render (module runs pre-mount).
{
  const s = useSettingsStore.getState();
  applyTheme(getTheme(s.themeId), s.accentOverride);
  applyAmbientAttr(s.ambientMotion);
}

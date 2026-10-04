import { create } from "zustand";
import { applyTheme, getTheme } from "../themes";

export const MIN_FONT_SIZE = 9;
export const MAX_FONT_SIZE = 32;
export const DEFAULT_FONT_SIZE = 17;

export type CursorStyle = "block" | "bar" | "underline";
export type Locale = "zh" | "en";
/** Window material preference. `glass` needs native support; see lib/windowAppearance. */
export type WindowMaterial = "solid" | "glass";

export const MIN_BG_OPACITY = 0.1;
export const MAX_BG_OPACITY = 1;
export const DEFAULT_BG_OPACITY = 0.75;

/** Unknown or missing values keep the existing solid appearance. */
export function normalizeWindowMaterial(raw: string | null): WindowMaterial {
  return raw === "glass" ? "glass" : "solid";
}

/**
 * Missing, malformed, empty or non-finite input falls back to 0.75; finite
 * out-of-range values clamp to 0.10–1.00.
 */
export function normalizeBackgroundOpacity(raw: string | null): number {
  if (raw === null || raw.trim() === "") return DEFAULT_BG_OPACITY;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_BG_OPACITY;
  return Math.min(MAX_BG_OPACITY, Math.max(MIN_BG_OPACITY, n));
}

/**
 * Animation speed multiplier, playback-rate style: 2 runs twice as fast, 0.5
 * half as fast. Durations divide by it, which is what `--anim-scale` carries.
 */
export const ANIM_SPEEDS = [0.5, 0.75, 1, 1.5, 2] as const;
export const DEFAULT_ANIM_SPEED = 1;

/** First run follows the OS: a zh-* UI language starts the app in Chinese. */
function loadLocale(): Locale {
  const raw = localStorage.getItem(LOCALE_KEY);
  if (raw === "zh" || raw === "en") return raw;
  return navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

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
const FLEET_CMD_KEY = "logan.fleetCommand";
const LOCALE_KEY = "logan.locale";
const ANIM_SPEED_KEY = "logan.animSpeed";
const MATH_INLINE_KEY = "logan.mathInline";
const MATH_FOLLOW_KEY = "logan.mathAutoFollow";
const WINDOW_MATERIAL_KEY = "logan.windowMaterial";
const BG_OPACITY_KEY = "logan.backgroundOpacity";
const BACKGROUND_BLUR_KEY = "logan.backgroundBlur";
const DEFAULT_FLEET_CMD = "claude";

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

function loadAnimSpeed(): number {
  const n = Number(localStorage.getItem(ANIM_SPEED_KEY));
  return (ANIM_SPEEDS as readonly number[]).includes(n) ? n : DEFAULT_ANIM_SPEED;
}

/**
 * Push the speed to CSS as a *duration* multiplier: every animation in
 * index.css is written as `calc(var(--anim-scale) * <base>)`, so one variable
 * retimes them all without any of them knowing about the setting.
 */
function applyAnimScale(speed: number) {
  document.documentElement.style.setProperty("--anim-scale", String(1 / speed));
}

interface SettingsStore {
  /** UI language. Terminal content is never touched by this. */
  locale: Locale;
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
  /** Playback rate for the app's own animations — see [`ANIM_SPEEDS`]. */
  animSpeed: number;
  /** Desktop toast when a long command finishes out of view (OSC 133). */
  notifyLongCommands: boolean;
  /** Desktop toast when a terminal bell rings out of view (agent prompts). */
  notifyBell: boolean;
  /** Underline LaTeX in terminal output and preview it on hover. */
  mathInline: boolean;
  /** Push newly-printed formulas into the Math panel automatically. */
  mathAutoFollow: boolean;
  /** Preferred window material. Effective state lives in windowAppearance. */
  windowMaterial: WindowMaterial;
  /** Glass background opacity, 0.10–1.00; remembered while solid is shown. */
  backgroundOpacity: number;
  /**
   * Whether glass applies the native frost (Vibrancy/Acrylic). Off = a clear
   * window: the desktop shows through crisply under the tint. Only meaningful
   * while the material preference is glass; the saved value is kept either way.
   */
  backgroundBlur: boolean;
  /**
   * Command auto-run in every pane of a fleet tab (⌘P → "New fleet tab").
   * Empty string = spawn plain shells.
   */
  fleetCommand: string;
  /** Settings panel visibility — UI state, not persisted. */
  panelOpen: boolean;
  setLocale: (locale: Locale) => void;
  bumpFontSize: (delta: number) => void;
  resetFontSize: () => void;
  toggleHiddenFiles: () => void;
  setTheme: (id: string) => void;
  setAccentOverride: (color: string | null) => void;
  setCursorStyle: (style: CursorStyle) => void;
  toggleCursorBlink: () => void;
  toggleAmbientMotion: () => void;
  toggleCrtMode: () => void;
  setAnimSpeed: (speed: number) => void;
  toggleNotifyLongCommands: () => void;
  toggleNotifyBell: () => void;
  toggleMathInline: () => void;
  toggleMathAutoFollow: () => void;
  setWindowMaterial: (material: WindowMaterial) => void;
  setBackgroundOpacity: (opacity: number) => void;
  setBackgroundBlur: (blur: boolean) => void;
  setFleetCommand: (cmd: string) => void;
  setPanelOpen: (open: boolean) => void;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  locale: loadLocale(),
  fontSize: loadFontSize(),
  showHiddenFiles: localStorage.getItem(SHOW_HIDDEN_KEY) === "1",
  themeId: loadThemeId(),
  accentOverride: loadAccent(),
  cursorStyle: loadCursorStyle(),
  cursorBlink: loadBool(CURSOR_BLINK_KEY, true),
  ambientMotion: loadBool(AMBIENT_KEY, true),
  crtMode: loadBool(CRT_KEY, false),
  animSpeed: loadAnimSpeed(),
  notifyLongCommands: loadBool(NOTIFY_LONG_KEY, true),
  notifyBell: loadBool(NOTIFY_BELL_KEY, true),
  mathInline: loadBool(MATH_INLINE_KEY, true),
  mathAutoFollow: loadBool(MATH_FOLLOW_KEY, true),
  windowMaterial: normalizeWindowMaterial(localStorage.getItem(WINDOW_MATERIAL_KEY)),
  backgroundOpacity: normalizeBackgroundOpacity(localStorage.getItem(BG_OPACITY_KEY)),
  backgroundBlur: loadBool(BACKGROUND_BLUR_KEY, true),
  fleetCommand: localStorage.getItem(FLEET_CMD_KEY) ?? DEFAULT_FLEET_CMD,
  panelOpen: false,
  setLocale: (locale) => {
    localStorage.setItem(LOCALE_KEY, locale);
    set({ locale });
  },
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
  setAnimSpeed: (speed) => {
    const next = (ANIM_SPEEDS as readonly number[]).includes(speed)
      ? speed
      : DEFAULT_ANIM_SPEED;
    localStorage.setItem(ANIM_SPEED_KEY, String(next));
    applyAnimScale(next);
    set({ animSpeed: next });
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
  toggleMathInline: () => {
    const next = !get().mathInline;
    localStorage.setItem(MATH_INLINE_KEY, next ? "1" : "0");
    set({ mathInline: next });
  },
  toggleMathAutoFollow: () => {
    const next = !get().mathAutoFollow;
    localStorage.setItem(MATH_FOLLOW_KEY, next ? "1" : "0");
    set({ mathAutoFollow: next });
  },
  setWindowMaterial: (material) => {
    const next = normalizeWindowMaterial(material);
    localStorage.setItem(WINDOW_MATERIAL_KEY, next);
    set({ windowMaterial: next });
  },
  setBackgroundOpacity: (opacity) => {
    const next = normalizeBackgroundOpacity(String(opacity));
    localStorage.setItem(BG_OPACITY_KEY, String(next));
    set({ backgroundOpacity: next });
  },
  setBackgroundBlur: (blur) => {
    localStorage.setItem(BACKGROUND_BLUR_KEY, blur ? "1" : "0");
    set({ backgroundBlur: blur });
  },
  setFleetCommand: (cmd) => {
    const trimmed = cmd.trim();
    localStorage.setItem(FLEET_CMD_KEY, trimmed);
    set({ fleetCommand: trimmed });
  },
  setPanelOpen: (open) => set({ panelOpen: open }),
}));

// Apply the persisted theme before first render (module runs pre-mount).
{
  const s = useSettingsStore.getState();
  applyTheme(getTheme(s.themeId), s.accentOverride);
  applyAmbientAttr(s.ambientMotion);
  applyAnimScale(s.animSpeed);
}

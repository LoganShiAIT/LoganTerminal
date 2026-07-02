import type { ITheme } from "@xterm/xterm";

/**
 * Single source of truth for theming. Each theme drives both the Tailwind
 * design tokens (via CSS variables applied in applyTheme) and the xterm
 * palette (via buildXtermTheme) — they can no longer drift apart.
 * The @theme block in index.css only holds warm-dark fallbacks for the
 * first paint before this module runs.
 */

interface UiTokens {
  base: string;
  panel: string;
  raise: string;
  ink: string;
  muted: string;
  faint: string;
  accent: string;
}

/** ANSI + background/foreground; cursor & selection are derived from accent. */
type XtermPalette = Omit<
  ITheme,
  "cursor" | "cursorAccent" | "selectionBackground"
>;

export interface Theme {
  id: string;
  name: string;
  dark: boolean;
  /** Alpha used to derive the `edge` border token from the accent. */
  edgeAlpha: number;
  ui: UiTokens;
  xterm: XtermPalette;
}

export const DEFAULT_THEME_ID = "warm-dark";

export const THEMES: Theme[] = [
  {
    id: "warm-dark",
    name: "Warm Dark",
    dark: true,
    edgeAlpha: 0.14,
    ui: {
      base: "#1a1512",
      panel: "#14100d",
      raise: "#251c16",
      ink: "#f5efe8",
      muted: "#a89285",
      faint: "#776557",
      accent: "#d97757",
    },
    xterm: {
      background: "#14100d",
      foreground: "#f5efe8",
      black: "#2a201b",
      red: "#f87171",
      green: "#86d68a",
      yellow: "#e6b264",
      blue: "#7aa5d9",
      magenta: "#c084fc",
      cyan: "#5eb3b3",
      white: "#f5efe8",
      brightBlack: "#5a4a42",
      brightRed: "#fca5a5",
      brightGreen: "#a5e6a8",
      brightYellow: "#f5c785",
      brightBlue: "#a3c1e0",
      brightMagenta: "#d8b4fe",
      brightCyan: "#8fcfcf",
      brightWhite: "#faf6f1",
    },
  },
  {
    id: "midnight",
    name: "Midnight",
    dark: true,
    edgeAlpha: 0.16,
    ui: {
      base: "#131720",
      panel: "#0f131b",
      raise: "#1c2230",
      ink: "#c8d3f5",
      muted: "#828bb8",
      faint: "#545c7e",
      accent: "#82aaff",
    },
    xterm: {
      background: "#0f131b",
      foreground: "#c8d3f5",
      black: "#1b1d2b",
      red: "#ff757f",
      green: "#c3e88d",
      yellow: "#ffc777",
      blue: "#82aaff",
      magenta: "#c099ff",
      cyan: "#86e1fc",
      white: "#c8d3f5",
      brightBlack: "#545c7e",
      brightRed: "#ff9aa0",
      brightGreen: "#d5f2ab",
      brightYellow: "#ffd8a0",
      brightBlue: "#a8c7ff",
      brightMagenta: "#d5b8ff",
      brightCyan: "#b2ecfe",
      brightWhite: "#dfe6fd",
    },
  },
  {
    id: "moss",
    name: "Moss",
    dark: true,
    edgeAlpha: 0.15,
    ui: {
      base: "#181c17",
      panel: "#131711",
      raise: "#232a20",
      ink: "#e8e5d5",
      muted: "#a89f8b",
      faint: "#6e6a58",
      accent: "#8ec07c",
    },
    xterm: {
      background: "#131711",
      foreground: "#e8e5d5",
      black: "#2a2e27",
      red: "#ea6962",
      green: "#a9b665",
      yellow: "#d8a657",
      blue: "#7daea3",
      magenta: "#d3869b",
      cyan: "#89b482",
      white: "#e8e5d5",
      brightBlack: "#5b6152",
      brightRed: "#f28b82",
      brightGreen: "#bcc87a",
      brightYellow: "#e3b56b",
      brightBlue: "#97c5bb",
      brightMagenta: "#e09cb0",
      brightCyan: "#9ccb96",
      brightWhite: "#f2efdf",
    },
  },
  {
    id: "latte",
    name: "Latte",
    dark: false,
    edgeAlpha: 0.28,
    ui: {
      base: "#efe7db",
      panel: "#f7f2ea",
      raise: "#e5dbcb",
      ink: "#40342a",
      muted: "#82705f",
      faint: "#ab9c8b",
      accent: "#c65d3e",
    },
    xterm: {
      background: "#f7f2ea",
      foreground: "#40342a",
      black: "#5a4f43",
      red: "#c14a4a",
      green: "#6c782e",
      yellow: "#b47109",
      blue: "#45707a",
      magenta: "#945e80",
      cyan: "#4c7a5d",
      white: "#efe7db",
      brightBlack: "#8a7c6c",
      brightRed: "#d15d5d",
      brightGreen: "#82973b",
      brightYellow: "#cc8a11",
      brightBlue: "#5a8b96",
      brightMagenta: "#ab7295",
      brightCyan: "#5f966f",
      brightWhite: "#faf6ef",
    },
  },
];

export function getTheme(id: string | null | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/** #rrggbb → rgba(); returns the input untouched for anything else. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}, ${alpha})`;
}

/** Push a theme's tokens into the CSS variables Tailwind utilities read. */
export function applyTheme(theme: Theme, accentOverride: string | null) {
  const accent = accentOverride ?? theme.ui.accent;
  const root = document.documentElement;
  const vars: Record<string, string> = {
    "--color-base": theme.ui.base,
    "--color-panel": theme.ui.panel,
    "--color-raise": theme.ui.raise,
    "--color-ink": theme.ui.ink,
    "--color-muted": theme.ui.muted,
    "--color-faint": theme.ui.faint,
    "--color-accent": accent,
    "--color-edge": withAlpha(accent, theme.edgeAlpha),
  };
  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v);
  }
  root.style.colorScheme = theme.dark ? "dark" : "light";
}

export function buildXtermTheme(
  themeId: string,
  accentOverride: string | null,
): ITheme {
  const theme = getTheme(themeId);
  const accent = accentOverride ?? theme.ui.accent;
  return {
    ...theme.xterm,
    cursor: accent,
    cursorAccent: theme.xterm.background,
    selectionBackground: withAlpha(accent, 0.3),
  };
}

export function buildSearchDecorations(
  themeId: string,
  accentOverride: string | null,
) {
  const theme = getTheme(themeId);
  const accent = accentOverride ?? theme.ui.accent;
  return {
    matchBackground: withAlpha(accent, theme.dark ? 0.28 : 0.35),
    matchBorder: "#00000000",
    matchOverviewRuler: withAlpha(accent, 0.5),
    activeMatchBackground: accent,
    activeMatchBorder: "#00000000",
    activeMatchColorOverviewRuler: accent,
  };
}

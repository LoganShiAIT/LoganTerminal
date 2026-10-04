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
  {
    id: "classic",
    name: "Classic",
    dark: true,
    edgeAlpha: 0.16,
    ui: {
      base: "#101010",
      panel: "#000000",
      raise: "#1c1c1c",
      ink: "#e0e0e0",
      muted: "#999999",
      faint: "#6a6a6a",
      accent: "#cfcfcf",
    },
    xterm: {
      background: "#000000",
      foreground: "#d0d0d0",
      black: "#3a3a3a",
      red: "#cc5f5f",
      green: "#78ad5c",
      yellow: "#c9a54e",
      blue: "#6d92c9",
      magenta: "#a97fbe",
      cyan: "#5da5a5",
      white: "#d0d0d0",
      brightBlack: "#6a6a6a",
      brightRed: "#e08585",
      brightGreen: "#97c47c",
      brightYellow: "#dbbd72",
      brightBlue: "#93b0d9",
      brightMagenta: "#c2a0d1",
      brightCyan: "#82bfbf",
      brightWhite: "#f0f0f0",
    },
  },
  {
    id: "graphite",
    name: "Graphite",
    dark: true,
    edgeAlpha: 0.18,
    ui: {
      base: "#1b1d1f",
      panel: "#151719",
      raise: "#24272a",
      ink: "#dfe1e2",
      muted: "#9aa0a4",
      faint: "#666d72",
      accent: "#8fa9a6",
    },
    xterm: {
      background: "#151719",
      foreground: "#dfe1e2",
      black: "#2b2f32",
      red: "#c08a86",
      green: "#9db38c",
      yellow: "#cbb287",
      blue: "#8fa6bd",
      magenta: "#b09ab5",
      cyan: "#8fb2b0",
      white: "#dfe1e2",
      brightBlack: "#6b7377",
      brightRed: "#d3a29e",
      brightGreen: "#b4c8a4",
      brightYellow: "#ddc7a1",
      brightBlue: "#a9bccf",
      brightMagenta: "#c5b2c9",
      brightCyan: "#a7c6c4",
      brightWhite: "#eef0f0",
    },
  },
  {
    id: "sakura",
    name: "Sakura",
    dark: false,
    edgeAlpha: 0.26,
    ui: {
      base: "#f7ecef",
      panel: "#fdf5f7",
      raise: "#f0dde3",
      ink: "#4a3238",
      muted: "#97717d",
      faint: "#c0a0aa",
      accent: "#d1477a",
    },
    xterm: {
      background: "#fdf5f7",
      foreground: "#4a3238",
      black: "#5f474e",
      red: "#c9184a",
      green: "#4f9d69",
      yellow: "#b0722b",
      blue: "#5677a8",
      magenta: "#b05390",
      cyan: "#4a8f8c",
      white: "#f0dde3",
      brightBlack: "#8f6d77",
      brightRed: "#e0356a",
      brightGreen: "#63b57e",
      brightYellow: "#c98a3d",
      brightBlue: "#6d8fc0",
      brightMagenta: "#c76dab",
      brightCyan: "#5fa8a4",
      brightWhite: "#fbf0f3",
    },
  },
  {
    id: "ocean",
    name: "Ocean",
    dark: true,
    edgeAlpha: 0.17,
    ui: {
      base: "#0c1620",
      panel: "#091019",
      raise: "#152433",
      ink: "#d9ebf7",
      muted: "#7fa3bd",
      faint: "#4e6a80",
      accent: "#38bdf8",
    },
    xterm: {
      background: "#091019",
      foreground: "#d9ebf7",
      black: "#14212e",
      red: "#ff6b81",
      green: "#4ade80",
      yellow: "#fbbf24",
      blue: "#38bdf8",
      magenta: "#a78bfa",
      cyan: "#22d3ee",
      white: "#d9ebf7",
      brightBlack: "#3f596e",
      brightRed: "#ff94a4",
      brightGreen: "#7ce9a5",
      brightYellow: "#fcd34d",
      brightBlue: "#7cd1fa",
      brightMagenta: "#c4b0fc",
      brightCyan: "#67e3f4",
      brightWhite: "#eef7fc",
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
  transparentBackground = false,
): ITheme {
  const theme = getTheme(themeId);
  const accent = accentOverride ?? theme.ui.accent;
  return {
    ...theme.xterm,
    // Glass mode: the pane's own surface (CSS) paints the base tint once and
    // xterm's default background gets out of the way. ANSI backgrounds,
    // cursor and selection keep their palette colors either way.
    background: transparentBackground
      ? "#00000000"
      : theme.xterm.background,
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

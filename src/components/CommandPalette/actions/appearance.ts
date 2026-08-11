import {
  ANIM_SPEEDS,
  type CursorStyle,
  type Locale,
} from "../../../stores/settingsStore";
import { THEMES } from "../../../themes";
import { t } from "../../../i18n";
import { settings, type PaletteAction } from "./types";

/** The accents also offered as swatches in Settings — keep the two in step. */
const ACCENT_CHOICES: Array<{ name: string; color: string }> = [
  { name: "Coral", color: "#d97757" },
  { name: "Blue", color: "#82aaff" },
  { name: "Green", color: "#8ec07c" },
  { name: "Violet", color: "#c099ff" },
  { name: "Pink", color: "#f7768e" },
  { name: "Teal", color: "#5eb3b3" },
];

const CURSOR_STYLES: Array<{ id: CursorStyle; name: string }> = [
  { id: "block", name: "Block" },
  { id: "bar", name: "Bar" },
  { id: "underline", name: "Underline" },
];

interface AppearanceState {
  locale: Locale;
  themeId: string;
  accentOverride: string | null;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  ambientMotion: boolean;
  crtMode: boolean;
  animSpeed: number;
}

/** Language, theme, accent, cursor and effects — everything cosmetic. */
export function appearanceActions(s: AppearanceState): PaletteAction[] {
  const group = t("Appearance");
  const actions: PaletteAction[] = [
    {
      id: "locale-zh",
      group,
      label: t("Language: {name}", { name: "中文" }),
      active: s.locale === "zh",
      run: () => settings().setLocale("zh"),
    },
    {
      id: "locale-en",
      group,
      label: t("Language: {name}", { name: "English" }),
      active: s.locale === "en",
      run: () => settings().setLocale("en"),
    },
  ];

  for (const theme of THEMES) {
    actions.push({
      id: `theme-${theme.id}`,
      group,
      label: t("Theme: {name}", { name: theme.name }),
      swatch: theme.ui.accent,
      active: theme.id === s.themeId,
      run: () => settings().setTheme(theme.id),
    });
  }

  actions.push({
    id: "accent-auto",
    group,
    label: t("Accent: Auto (theme default)"),
    active: s.accentOverride === null,
    run: () => settings().setAccentOverride(null),
  });
  for (const a of ACCENT_CHOICES) {
    actions.push({
      id: `accent-${a.name}`,
      group,
      label: t("Accent: {name}", { name: t(a.name) }),
      swatch: a.color,
      active: a.color.toLowerCase() === s.accentOverride?.toLowerCase(),
      run: () => settings().setAccentOverride(a.color),
    });
  }

  for (const c of CURSOR_STYLES) {
    actions.push({
      id: `cursor-${c.id}`,
      group,
      label: t("Cursor: {name}", { name: t(c.name) }),
      active: s.cursorStyle === c.id,
      run: () => settings().setCursorStyle(c.id),
    });
  }

  actions.push(
    {
      id: "fx-cursor-blink",
      group,
      label: t("Toggle cursor blink"),
      active: s.cursorBlink,
      run: () => settings().toggleCursorBlink(),
    },
    {
      id: "fx-ambient",
      group,
      label: t("Toggle ambient motion"),
      active: s.ambientMotion,
      run: () => settings().toggleAmbientMotion(),
    },
    {
      id: "fx-crt",
      group,
      label: t("Toggle CRT mode"),
      active: s.crtMode,
      run: () => settings().toggleCrtMode(),
    },
  );

  for (const speed of ANIM_SPEEDS) {
    actions.push({
      id: `anim-${speed}`,
      group,
      label: t("Animation speed: {speed}×", { speed }),
      active: speed === s.animSpeed,
      run: () => settings().setAnimSpeed(speed),
    });
  }

  return actions;
}

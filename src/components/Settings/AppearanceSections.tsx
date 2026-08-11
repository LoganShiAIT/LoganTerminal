import { useRef } from "react";
import {
  useSettingsStore,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
  DEFAULT_FONT_SIZE,
  ANIM_SPEEDS,
  DEFAULT_ANIM_SPEED,
  type CursorStyle,
  type Locale,
} from "../../stores/settingsStore";
import { THEMES } from "../../themes";
import { kbd } from "../../lib/keys";
import { useT } from "../../i18n";
import { Section, ChoiceButton, ToggleRow, Hint } from "./controls";

/** Kept in step with ACCENT_CHOICES in the command palette's actions. */
const ACCENT_PRESETS = [
  "#d97757", // claude coral
  "#82aaff", // blue
  "#8ec07c", // green
  "#c099ff", // violet
  "#f7768e", // pink
  "#5eb3b3", // teal
];

export function LanguageSection() {
  const t = useT();
  const locale = useSettingsStore((s) => s.locale);
  const setLocale = useSettingsStore((s) => s.setLocale);
  const options: Array<{ id: Locale; name: string }> = [
    { id: "zh", name: "中文" },
    { id: "en", name: "English" },
  ];

  return (
    <Section label={t("Language")}>
      <div className="flex items-center gap-2">
        {options.map((o) => (
          <ChoiceButton
            key={o.id}
            selected={locale === o.id}
            onClick={() => setLocale(o.id)}
          >
            {o.name}
          </ChoiceButton>
        ))}
      </div>
    </Section>
  );
}

export function ThemeSection() {
  const t = useT();
  const themeId = useSettingsStore((s) => s.themeId);
  const setTheme = useSettingsStore((s) => s.setTheme);

  return (
    <Section label={t("Theme")}>
      <div className="grid grid-cols-2 gap-2">
        {THEMES.map((theme) => (
          <button
            key={theme.id}
            onClick={() => setTheme(theme.id)}
            className={`rounded-xl border p-3 text-left transition-[border-color,box-shadow] duration-150 ${
              theme.id === themeId
                ? "border-accent shadow-[0_0_0_1px_var(--color-accent)]"
                : "border-edge hover:border-accent/50"
            }`}
            style={{ backgroundColor: theme.ui.base }}
          >
            <div className="flex items-end gap-1 font-mono text-sm mb-2">
              <span style={{ color: theme.ui.accent }}>❯</span>
              <span
                className="inline-block w-[0.5em] h-[1em] rounded-[1px]"
                style={{ backgroundColor: theme.ui.accent }}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: theme.ui.ink }}>
                {theme.name}
              </span>
              <span className="flex gap-1">
                {[
                  theme.xterm.red,
                  theme.xterm.green,
                  theme.xterm.yellow,
                  theme.xterm.blue,
                ]
                  .filter((c): c is string => Boolean(c))
                  .map((c) => (
                    <span
                      key={c}
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: c }}
                    />
                  ))}
              </span>
            </div>
          </button>
        ))}
      </div>
    </Section>
  );
}

export function AccentSection() {
  const t = useT();
  const accentOverride = useSettingsStore((s) => s.accentOverride);
  const setAccentOverride = useSettingsStore((s) => s.setAccentOverride);
  const colorInputRef = useRef<HTMLInputElement>(null);

  const isPreset = ACCENT_PRESETS.some(
    (c) => c.toLowerCase() === accentOverride?.toLowerCase(),
  );
  const isCustom = Boolean(accentOverride) && !isPreset;

  const pill = (selected: boolean) =>
    `h-7 px-2.5 rounded-full border text-[11px] transition-colors ${
      selected
        ? "border-accent text-accent bg-accent/10"
        : "border-edge text-muted hover:text-ink hover:border-accent/40"
    }`;

  return (
    <Section label={t("Accent")}>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setAccentOverride(null)}
          className={pill(accentOverride === null)}
          title={t("Use the theme's own accent")}
        >
          {t("auto")}
        </button>
        {ACCENT_PRESETS.map((c) => (
          <button
            key={c}
            onClick={() => setAccentOverride(c)}
            className={`w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 ${
              c.toLowerCase() === accentOverride?.toLowerCase()
                ? "border-ink/80"
                : "border-transparent"
            }`}
            style={{ backgroundColor: c }}
            title={c}
          />
        ))}
        <button
          onClick={() => colorInputRef.current?.click()}
          className={`relative ${pill(isCustom)}`}
          title={t("Pick a custom accent color")}
        >
          {t("custom…")}
          {/* The real color input is invisible; the pill is the affordance. */}
          <input
            ref={colorInputRef}
            type="color"
            value={accentOverride ?? ACCENT_PRESETS[0]}
            onChange={(e) => setAccentOverride(e.target.value)}
            className="absolute inset-0 opacity-0 pointer-events-none"
            tabIndex={-1}
          />
        </button>
      </div>
    </Section>
  );
}

export function FontSizeSection() {
  const t = useT();
  const fontSize = useSettingsStore((s) => s.fontSize);
  const bump = useSettingsStore((s) => s.bumpFontSize);
  const reset = useSettingsStore((s) => s.resetFontSize);

  const btn =
    "w-7 h-7 grid place-items-center rounded-md border border-edge text-muted hover:text-ink hover:border-accent/40 transition-colors disabled:opacity-30 disabled:pointer-events-none";

  return (
    <Section label={t("Font size")}>
      <div className="flex items-center gap-2">
        <button
          className={btn}
          onClick={() => bump(-1)}
          disabled={fontSize <= MIN_FONT_SIZE}
          title={t("Smaller ({key})", { key: kbd("⌘−") })}
        >
          −
        </button>
        <span className="font-mono text-sm text-ink w-8 text-center">
          {fontSize}
        </span>
        <button
          className={btn}
          onClick={() => bump(1)}
          disabled={fontSize >= MAX_FONT_SIZE}
          title={t("Larger ({key})", { key: kbd("⌘+") })}
        >
          +
        </button>
        {fontSize !== DEFAULT_FONT_SIZE && (
          <button
            className="h-7 px-2.5 rounded-md text-[11px] text-muted hover:text-ink hover:bg-ink/5 transition-colors"
            onClick={reset}
            title={t("Reset ({key})", { key: kbd("⌘0") })}
          >
            {t("reset")}
          </button>
        )}
      </div>
    </Section>
  );
}

export function CursorSection() {
  const t = useT();
  const cursorStyle = useSettingsStore((s) => s.cursorStyle);
  const setCursorStyle = useSettingsStore((s) => s.setCursorStyle);
  const cursorBlink = useSettingsStore((s) => s.cursorBlink);
  const toggleBlink = useSettingsStore((s) => s.toggleCursorBlink);

  const styles: Array<{ id: CursorStyle; name: string; glyph: string }> = [
    { id: "block", name: t("Block"), glyph: "▮" },
    { id: "bar", name: t("Bar"), glyph: "▏" },
    { id: "underline", name: t("Underline"), glyph: "▁" },
  ];

  return (
    <Section label={t("Cursor")}>
      <div className="flex items-center gap-2 flex-wrap">
        {styles.map((s) => (
          <ChoiceButton
            key={s.id}
            selected={s.id === cursorStyle}
            onClick={() => setCursorStyle(s.id)}
          >
            <span className="font-mono text-[13px] leading-none">{s.glyph}</span>
            {s.name}
          </ChoiceButton>
        ))}
      </div>
      <div className="mt-2.5">
        <ToggleRow
          checked={cursorBlink}
          onToggle={toggleBlink}
          label={t("Blinking cursor")}
        />
      </div>
    </Section>
  );
}

export function EffectsSection() {
  const t = useT();
  const ambientMotion = useSettingsStore((s) => s.ambientMotion);
  const toggleAmbient = useSettingsStore((s) => s.toggleAmbientMotion);
  const crtMode = useSettingsStore((s) => s.crtMode);
  const toggleCrt = useSettingsStore((s) => s.toggleCrtMode);

  return (
    <Section label={t("Effects")}>
      <AnimSpeedRow />
      <div className="space-y-2.5">
        <ToggleRow
          checked={ambientMotion}
          onToggle={toggleAmbient}
          label={t("Ambient motion — drifting grid & floating glow")}
          title={t("Respects the system reduced-motion preference")}
        />
        <ToggleRow
          checked={crtMode}
          onToggle={toggleCrt}
          label={t("CRT mode — retro scanlines over the terminal")}
        />
      </div>
    </Section>
  );
}

/**
 * Animation playback rate. Reads as a video-player speed — 2× is twice as
 * fast, 0.5× is half — and lands in CSS as the inverse duration multiplier.
 */
function AnimSpeedRow() {
  const t = useT();
  const animSpeed = useSettingsStore((s) => s.animSpeed);
  const setAnimSpeed = useSettingsStore((s) => s.setAnimSpeed);

  return (
    <div className="mb-3">
      <div className="mb-1.5 text-[11px] text-muted">{t("Animation speed")}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {ANIM_SPEEDS.map((speed) => (
          <ChoiceButton
            key={speed}
            mono
            selected={speed === animSpeed}
            onClick={() => setAnimSpeed(speed)}
            title={
              speed === DEFAULT_ANIM_SPEED
                ? t("Normal speed")
                : speed < DEFAULT_ANIM_SPEED
                  ? t("Slower, more deliberate")
                  : t("Snappier")
            }
          >
            {speed}×
          </ChoiceButton>
        ))}
      </div>
      <div className="mt-1.5">
        <Hint>
          {t(
            "Retimes the app's own motion — panel swaps, ambient drift, the header sweep. Terminal output is never delayed.",
          )}
        </Hint>
      </div>
    </div>
  );
}

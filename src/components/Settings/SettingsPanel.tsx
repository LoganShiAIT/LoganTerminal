import { useEffect, useRef } from "react";
import {
  useSettingsStore,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
  DEFAULT_FONT_SIZE,
  type CursorStyle,
} from "../../stores/settingsStore";
import { usePromptStore } from "../../stores/promptStore";
import { THEMES } from "../../themes";
import { kbd } from "../../lib/keys";

const ACCENT_PRESETS = [
  "#d97757", // claude coral
  "#82aaff", // blue
  "#8ec07c", // green
  "#c099ff", // violet
  "#f7768e", // pink
  "#5eb3b3", // teal
];

export default function SettingsPanel() {
  const open = useSettingsStore((s) => s.panelOpen);
  const setOpen = useSettingsStore((s) => s.setPanelOpen);

  // Capture-phase Esc so it wins over the focused xterm textarea.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-[2px] animate-[fade-in_0.12s_ease-out]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="w-[460px] max-h-[82vh] overflow-y-auto rounded-2xl border border-edge bg-raise shadow-[0_16px_60px_rgba(0,0,0,0.5)] animate-[pop-in_0.14s_ease-out]">
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-edge sticky top-0 bg-raise z-10">
          <div className="text-[11px] uppercase tracking-[0.22em] text-accent font-semibold">
            Settings
          </div>
          <button
            className="w-6 h-6 grid place-items-center rounded-md text-[14px] leading-none text-muted hover:text-ink hover:bg-ink/10 transition-colors"
            onClick={() => setOpen(false)}
            title="Close (esc)"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          <ThemeSection />
          <AccentSection />
          <FontSizeSection />
          <CursorSection />
          <EffectsSection />
          <NotificationsSection />
          <AgentsSection />
          <PromptsSection />
          <FilesSection />
        </div>

        <div className="px-5 pb-4 text-[10px] text-faint">
          Changes apply instantly and are remembered across restarts. Tip:
          everything here is also in the command palette ({kbd("⌘P")}).
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-[0.18em] text-muted mb-2">
      {children}
    </div>
  );
}

function AgentsSection() {
  const fleetCommand = useSettingsStore((s) => s.fleetCommand);
  const setFleetCommand = useSettingsStore((s) => s.setFleetCommand);

  return (
    <div>
      <SectionLabel>Agents</SectionLabel>
      <div className="space-y-1.5">
        <div className="text-[11px] text-muted">Fleet command</div>
        <input
          key={fleetCommand /* re-seed after external changes */}
          defaultValue={fleetCommand}
          placeholder="claude"
          spellCheck={false}
          className="w-full rounded-lg border border-edge bg-ink/[0.04] px-2.5 py-1.5 font-mono text-[11px] text-ink placeholder:text-faint focus:outline-none focus:border-accent/50"
          onBlur={(e) => setFleetCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
        <div className="text-[10px] leading-relaxed text-faint">
          Auto-run in every pane of a new fleet tab ({kbd("⌘P")} → "New fleet
          tab"). Leave empty for plain shells.
        </div>
      </div>
    </div>
  );
}

function PromptsSection() {
  const prompts = usePromptStore((s) => s.prompts);
  const addPrompt = usePromptStore((s) => s.addPrompt);
  const removePrompt = usePromptStore((s) => s.removePrompt);
  const titleRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const add = () => {
    const title = titleRef.current?.value ?? "";
    const text = textRef.current?.value ?? "";
    if (!title.trim() || !text.trim()) return;
    addPrompt(title, text);
    if (titleRef.current) titleRef.current.value = "";
    if (textRef.current) textRef.current.value = "";
    titleRef.current?.focus();
  };

  const field =
    "w-full rounded-lg border border-edge bg-ink/[0.04] px-2.5 py-1.5 font-mono text-[11px] text-ink placeholder:text-faint focus:outline-none focus:border-accent/50";

  return (
    <div>
      <SectionLabel>Prompts</SectionLabel>
      <div className="space-y-2">
        {prompts.length === 0 && (
          <div className="px-3 py-3 rounded-lg border border-dashed border-edge text-[11px] leading-relaxed text-faint">
            Save prompts you feed your agents often — insert them from the
            command palette ({kbd("⌘P")}) into the focused terminal.
          </div>
        )}
        {prompts.map((p) => (
          <div
            key={p.id}
            className="group flex items-start gap-2 rounded-lg border border-edge bg-ink/[0.03] px-2.5 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="text-xs text-ink truncate">{p.title}</div>
              <div className="font-mono text-[10px] text-faint whitespace-pre-wrap break-all line-clamp-2">
                {p.text}
              </div>
            </div>
            <button
              className="w-5 h-5 shrink-0 grid place-items-center rounded-md text-[12px] leading-none text-muted opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-white transition-[opacity,background-color,color]"
              onClick={() => removePrompt(p.id)}
              title="Delete prompt"
            >
              ×
            </button>
          </div>
        ))}
        <input ref={titleRef} placeholder="Prompt title" className={field} />
        <textarea
          ref={textRef}
          placeholder="Prompt text (multi-line ok — it inserts as one bracketed paste)"
          rows={3}
          className={`${field} resize-y`}
        />
        <button
          className="h-7 px-3 rounded-md border border-edge text-[11px] text-muted transition-colors hover:border-accent/40 hover:text-accent"
          onClick={add}
        >
          Add prompt
        </button>
      </div>
    </div>
  );
}

function ThemeSection() {
  const themeId = useSettingsStore((s) => s.themeId);
  const setTheme = useSettingsStore((s) => s.setTheme);

  return (
    <div>
      <SectionLabel>Theme</SectionLabel>
      <div className="grid grid-cols-2 gap-2">
        {THEMES.map((t) => {
          const selected = t.id === themeId;
          return (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={`rounded-xl border p-3 text-left transition-[border-color,box-shadow] duration-150 ${
                selected
                  ? "border-accent shadow-[0_0_0_1px_var(--color-accent)]"
                  : "border-edge hover:border-accent/50"
              }`}
              style={{ backgroundColor: t.ui.base }}
            >
              <div className="flex items-end gap-1 font-mono text-sm mb-2">
                <span style={{ color: t.ui.accent }}>❯</span>
                <span
                  className="inline-block w-[0.5em] h-[1em] rounded-[1px]"
                  style={{ backgroundColor: t.ui.accent }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: t.ui.ink }}>
                  {t.name}
                </span>
                <span className="flex gap-1">
                  {[t.xterm.red, t.xterm.green, t.xterm.yellow, t.xterm.blue]
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
          );
        })}
      </div>
    </div>
  );
}

function AccentSection() {
  const accentOverride = useSettingsStore((s) => s.accentOverride);
  const setAccentOverride = useSettingsStore((s) => s.setAccentOverride);
  const colorInputRef = useRef<HTMLInputElement>(null);

  const isPreset = ACCENT_PRESETS.some(
    (c) => c.toLowerCase() === accentOverride?.toLowerCase(),
  );
  const isCustom = Boolean(accentOverride) && !isPreset;

  return (
    <div>
      <SectionLabel>Accent</SectionLabel>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setAccentOverride(null)}
          className={`h-7 px-2.5 rounded-full border text-[11px] transition-colors ${
            accentOverride === null
              ? "border-accent text-accent bg-accent/10"
              : "border-edge text-muted hover:text-ink hover:border-accent/40"
          }`}
          title="Use the theme's own accent"
        >
          auto
        </button>
        {ACCENT_PRESETS.map((c) => {
          const selected = c.toLowerCase() === accentOverride?.toLowerCase();
          return (
            <button
              key={c}
              onClick={() => setAccentOverride(c)}
              className={`w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 ${
                selected ? "border-ink/80" : "border-transparent"
              }`}
              style={{ backgroundColor: c }}
              title={c}
            />
          );
        })}
        <button
          onClick={() => colorInputRef.current?.click()}
          className={`relative h-7 px-2.5 rounded-full border text-[11px] transition-colors ${
            isCustom
              ? "border-accent text-accent bg-accent/10"
              : "border-edge text-muted hover:text-ink hover:border-accent/40"
          }`}
          title="Pick a custom accent color"
        >
          custom…
          <input
            ref={colorInputRef}
            type="color"
            value={accentOverride ?? "#d97757"}
            onChange={(e) => setAccentOverride(e.target.value)}
            className="absolute inset-0 opacity-0 pointer-events-none"
            tabIndex={-1}
          />
        </button>
      </div>
    </div>
  );
}

function FontSizeSection() {
  const fontSize = useSettingsStore((s) => s.fontSize);
  const bump = useSettingsStore((s) => s.bumpFontSize);
  const reset = useSettingsStore((s) => s.resetFontSize);

  const btn =
    "w-7 h-7 grid place-items-center rounded-md border border-edge text-muted hover:text-ink hover:border-accent/40 transition-colors disabled:opacity-30 disabled:pointer-events-none";

  return (
    <div>
      <SectionLabel>Font size</SectionLabel>
      <div className="flex items-center gap-2">
        <button
          className={btn}
          onClick={() => bump(-1)}
          disabled={fontSize <= MIN_FONT_SIZE}
          title={`Smaller (${kbd("⌘−")})`}
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
          title={`Larger (${kbd("⌘+")})`}
        >
          +
        </button>
        {fontSize !== DEFAULT_FONT_SIZE && (
          <button
            className="h-7 px-2.5 rounded-md text-[11px] text-muted hover:text-ink hover:bg-ink/5 transition-colors"
            onClick={reset}
            title={`Reset (${kbd("⌘0")})`}
          >
            reset
          </button>
        )}
      </div>
    </div>
  );
}

function ToggleRow({
  checked,
  onToggle,
  label,
  title,
}: {
  checked: boolean;
  onToggle: () => void;
  label: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      className="flex items-center gap-2.5 group"
      onClick={onToggle}
      title={title}
    >
      <span
        className={`w-8 h-[18px] rounded-full p-[2px] transition-colors ${
          checked ? "bg-accent" : "bg-ink/15 group-hover:bg-ink/25"
        }`}
      >
        <span
          className={`block w-[14px] h-[14px] rounded-full bg-white/95 transition-transform ${
            checked ? "translate-x-[14px]" : ""
          }`}
        />
      </span>
      <span className="text-xs text-ink/85">{label}</span>
    </button>
  );
}

function CursorSection() {
  const cursorStyle = useSettingsStore((s) => s.cursorStyle);
  const setCursorStyle = useSettingsStore((s) => s.setCursorStyle);
  const cursorBlink = useSettingsStore((s) => s.cursorBlink);
  const toggleBlink = useSettingsStore((s) => s.toggleCursorBlink);

  const styles: Array<{ id: CursorStyle; name: string; glyph: string }> = [
    { id: "block", name: "Block", glyph: "▮" },
    { id: "bar", name: "Bar", glyph: "▏" },
    { id: "underline", name: "Underline", glyph: "▁" },
  ];

  return (
    <div>
      <SectionLabel>Cursor</SectionLabel>
      <div className="flex items-center gap-2 flex-wrap">
        {styles.map((s) => {
          const selected = s.id === cursorStyle;
          return (
            <button
              key={s.id}
              onClick={() => setCursorStyle(s.id)}
              className={`h-8 px-3 rounded-md border flex items-center gap-2 text-[11px] transition-colors ${
                selected
                  ? "border-accent text-accent bg-accent/10"
                  : "border-edge text-muted hover:text-ink hover:border-accent/40"
              }`}
            >
              <span className="font-mono text-[13px] leading-none">
                {s.glyph}
              </span>
              {s.name}
            </button>
          );
        })}
      </div>
      <div className="mt-2.5">
        <ToggleRow
          checked={cursorBlink}
          onToggle={toggleBlink}
          label="Blinking cursor"
        />
      </div>
    </div>
  );
}

function EffectsSection() {
  const ambientMotion = useSettingsStore((s) => s.ambientMotion);
  const toggleAmbient = useSettingsStore((s) => s.toggleAmbientMotion);
  const crtMode = useSettingsStore((s) => s.crtMode);
  const toggleCrt = useSettingsStore((s) => s.toggleCrtMode);

  return (
    <div>
      <SectionLabel>Effects</SectionLabel>
      <div className="space-y-2.5">
        <ToggleRow
          checked={ambientMotion}
          onToggle={toggleAmbient}
          label="Ambient motion — drifting grid & floating glow"
          title="Respects the system reduced-motion preference"
        />
        <ToggleRow
          checked={crtMode}
          onToggle={toggleCrt}
          label="CRT mode — retro scanlines over the terminal"
        />
      </div>
    </div>
  );
}

function NotificationsSection() {
  const notifyLong = useSettingsStore((s) => s.notifyLongCommands);
  const toggleLong = useSettingsStore((s) => s.toggleNotifyLongCommands);
  const notifyBell = useSettingsStore((s) => s.notifyBell);
  const toggleBell = useSettingsStore((s) => s.toggleNotifyBell);

  return (
    <div>
      <SectionLabel>Notifications</SectionLabel>
      <div className="space-y-2.5">
        <ToggleRow
          checked={notifyLong}
          onToggle={toggleLong}
          label="Notify when a long command finishes out of view"
          title="Commands over 10s, when the window is unfocused or the tab is hidden. Needs shell integration (zsh, or bash ≥ 4.4)."
        />
        <ToggleRow
          checked={notifyBell}
          onToggle={toggleBell}
          label="Notify on terminal bell out of view"
          title="Agent CLIs ring the bell when they need input. At most one toast per pane per 30s."
        />
      </div>
    </div>
  );
}

function FilesSection() {
  const showHidden = useSettingsStore((s) => s.showHiddenFiles);
  const toggle = useSettingsStore((s) => s.toggleHiddenFiles);

  return (
    <div>
      <SectionLabel>Files</SectionLabel>
      <ToggleRow
        checked={showHidden}
        onToggle={toggle}
        label="Show hidden files (dotfiles) in the file tree"
        title="Also affects the eye button in the file tree"
      />
    </div>
  );
}

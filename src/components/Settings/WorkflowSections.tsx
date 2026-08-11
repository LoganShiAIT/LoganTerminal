import { useRef } from "react";
import { useSettingsStore } from "../../stores/settingsStore";
import { usePromptStore } from "../../stores/promptStore";
import { kbd } from "../../lib/keys";
import { useT } from "../../i18n";
import { Section, ToggleRow, Hint, FIELD } from "./controls";

export function NotificationsSection() {
  const t = useT();
  const notifyLong = useSettingsStore((s) => s.notifyLongCommands);
  const toggleLong = useSettingsStore((s) => s.toggleNotifyLongCommands);
  const notifyBell = useSettingsStore((s) => s.notifyBell);
  const toggleBell = useSettingsStore((s) => s.toggleNotifyBell);

  return (
    <Section label={t("Notifications")}>
      <div className="space-y-2.5">
        <ToggleRow
          checked={notifyLong}
          onToggle={toggleLong}
          label={t("Notify when a long command finishes out of view")}
          title={t(
            "Commands over 10s, when the window is unfocused or the tab is hidden. Needs shell integration (zsh, or bash ≥ 4.4).",
          )}
        />
        <ToggleRow
          checked={notifyBell}
          onToggle={toggleBell}
          label={t("Notify on terminal bell out of view")}
          title={t(
            "Agent CLIs ring the bell when they need input. At most one toast per pane per 30s.",
          )}
        />
      </div>
    </Section>
  );
}

export function MathSection() {
  const t = useT();
  const inline = useSettingsStore((s) => s.mathInline);
  const toggleInline = useSettingsStore((s) => s.toggleMathInline);
  const follow = useSettingsStore((s) => s.mathAutoFollow);
  const toggleFollow = useSettingsStore((s) => s.toggleMathAutoFollow);

  return (
    <Section label={t("Math")}>
      <div className="space-y-2.5">
        <ToggleRow
          checked={inline}
          onToggle={toggleInline}
          label={t("Underline LaTeX in terminal output, preview on hover")}
          title={t(
            "Formulas printed by an agent get a dotted underline; hover shows them typeset, click sends them to the Math panel.",
          )}
        />
        <ToggleRow
          checked={follow}
          onToggle={toggleFollow}
          label={t("Math panel follows the newest formula automatically")}
          title={t("Pauses itself while you have unsaved edits in the panel.")}
        />
      </div>
    </Section>
  );
}

export function FilesSection() {
  const t = useT();
  const showHidden = useSettingsStore((s) => s.showHiddenFiles);
  const toggle = useSettingsStore((s) => s.toggleHiddenFiles);

  return (
    <Section label={t("Files")}>
      <ToggleRow
        checked={showHidden}
        onToggle={toggle}
        label={t("Show hidden files (dotfiles) in the file tree")}
        title={t("Also affects the eye button in the file tree")}
      />
    </Section>
  );
}

export function AgentsSection() {
  const t = useT();
  const fleetCommand = useSettingsStore((s) => s.fleetCommand);
  const setFleetCommand = useSettingsStore((s) => s.setFleetCommand);

  return (
    <Section label={t("Agents")}>
      <div className="space-y-1.5">
        <div className="text-[11px] text-muted">{t("Fleet command")}</div>
        <input
          key={fleetCommand /* re-seed after external changes */}
          defaultValue={fleetCommand}
          placeholder="claude"
          spellCheck={false}
          className={FIELD}
          onBlur={(e) => setFleetCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
        <Hint>
          {t(
            'Auto-run in every pane of a new fleet tab ({key} → "New fleet tab"). Leave empty for plain shells.',
            { key: kbd("⌘P") },
          )}
        </Hint>
      </div>
    </Section>
  );
}

export function PromptsSection() {
  const t = useT();
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

  return (
    <Section label={t("Prompts")}>
      <div className="space-y-2">
        {prompts.length === 0 && (
          <div className="px-3 py-3 rounded-lg border border-dashed border-edge text-[11px] leading-relaxed text-faint">
            {t(
              "Save prompts you feed your agents often — insert them from the command palette ({key}) into the focused terminal.",
              { key: kbd("⌘P") },
            )}
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
              title={t("Delete prompt")}
            >
              ×
            </button>
          </div>
        ))}
        <input ref={titleRef} placeholder={t("Prompt title")} className={FIELD} />
        <textarea
          ref={textRef}
          placeholder={t(
            "Prompt text (multi-line ok — it inserts as one bracketed paste)",
          )}
          rows={3}
          className={`${FIELD} resize-y`}
        />
        <button
          className="h-7 px-3 rounded-md border border-edge text-[11px] text-muted transition-colors hover:border-accent/40 hover:text-accent"
          onClick={add}
        >
          {t("Add prompt")}
        </button>
      </div>
    </Section>
  );
}

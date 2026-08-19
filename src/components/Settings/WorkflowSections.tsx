import { useRef } from "react";
import { useSettingsStore } from "../../stores/settingsStore";
import { usePromptStore } from "../../stores/promptStore";
import { useAgentLauncherStore } from "../../stores/agentLauncherStore";
import { launchLine } from "../../lib/agentLaunchers";
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

/**
 * The one-click launcher list behind the header's ⚡ menu, ⌘⇧L and the
 * palette. Command and flags are separate fields so the bypass switch can drop
 * the flags without anyone having to retype the command.
 */
export function AgentLaunchersSection() {
  const t = useT();
  const launchers = useAgentLauncherStore((s) => s.launchers);
  const bypass = useAgentLauncherStore((s) => s.bypassPermissions);
  const toggleBypass = useAgentLauncherStore((s) => s.toggleBypass);
  const toggleLauncher = useAgentLauncherStore((s) => s.toggleLauncher);
  const updateLauncher = useAgentLauncherStore((s) => s.updateLauncher);
  const addLauncher = useAgentLauncherStore((s) => s.addLauncher);
  const removeLauncher = useAgentLauncherStore((s) => s.removeLauncher);
  const resetLaunchers = useAgentLauncherStore((s) => s.resetLaunchers);
  const nameRef = useRef<HTMLInputElement>(null);
  const cmdRef = useRef<HTMLInputElement>(null);

  const add = () => {
    const name = nameRef.current?.value ?? "";
    const command = cmdRef.current?.value ?? "";
    if (!name.trim() || !command.trim()) return;
    addLauncher(name, command);
    if (nameRef.current) nameRef.current.value = "";
    if (cmdRef.current) cmdRef.current.value = "";
    nameRef.current?.focus();
  };

  return (
    <Section label={t("Agent launchers")}>
      <div className="space-y-2.5">
        <ToggleRow
          checked={bypass}
          onToggle={toggleBypass}
          label={t("Launch with permission prompts bypassed")}
          title={t(
            "Appends each CLI's skip-permissions flag. The agent can then edit and run anything in the directory it starts in.",
          )}
        />

        {launchers.map((l) => (
          <div
            key={l.id}
            className="rounded-lg border border-edge bg-ink/[0.03] px-2.5 py-2 space-y-1.5"
          >
            <div className="flex items-center gap-2">
              <button
                className={`w-3.5 h-3.5 shrink-0 rounded border transition-colors ${
                  l.enabled
                    ? "border-accent bg-accent"
                    : "border-edge hover:border-accent/50"
                }`}
                onClick={() => toggleLauncher(l.id)}
                title={l.enabled ? t("Hide from menus") : t("Show in menus")}
              />
              <span
                className={`text-[14px] ${l.enabled ? "text-ink" : "text-faint line-through"}`}
              >
                {l.name}
              </span>
              <span className="ml-auto truncate font-mono text-[12px] text-faint">
                {launchLine(l, bypass) || t("(no command)")}
              </span>
              {!l.builtin && (
                <button
                  className="w-5 h-5 shrink-0 grid place-items-center rounded-md text-[14px] leading-none text-muted hover:bg-accent hover:text-white transition-colors"
                  onClick={() => removeLauncher(l.id)}
                  title={t("Delete launcher")}
                >
                  ×
                </button>
              )}
            </div>
            <input
              key={`cmd:${l.command}`}
              defaultValue={l.command}
              placeholder={t("command")}
              spellCheck={false}
              className={FIELD}
              onBlur={(e) => updateLauncher(l.id, { command: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
            {/* Both only apply while the bypass switch above is on. Two fields
                because CLIs disagree about where the setting lives: a flag
                after the command, or an environment assignment before it. */}
            <div className="flex gap-1.5">
              <input
                key={`args:${l.bypassArgs}`}
                defaultValue={l.bypassArgs}
                placeholder={t("bypass flags")}
                spellCheck={false}
                className={FIELD}
                onBlur={(e) =>
                  updateLauncher(l.id, { bypassArgs: e.target.value })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
              />
              <input
                key={`env:${l.bypassEnv}`}
                defaultValue={l.bypassEnv}
                placeholder={t("bypass env (KEY=value)")}
                spellCheck={false}
                className={FIELD}
                onBlur={(e) =>
                  updateLauncher(l.id, { bypassEnv: e.target.value })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
              />
            </div>
          </div>
        ))}

        <div className="flex gap-1.5">
          <input ref={nameRef} placeholder={t("Name")} className={FIELD} />
          <input
            ref={cmdRef}
            placeholder={t("command")}
            spellCheck={false}
            className={FIELD}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            className="h-7 px-3 rounded-md border border-edge text-[13px] text-muted transition-colors hover:border-accent/40 hover:text-accent"
            onClick={add}
          >
            {t("Add launcher")}
          </button>
          <button
            className="h-7 px-3 rounded-md border border-edge text-[13px] text-muted transition-colors hover:border-accent/40 hover:text-accent"
            onClick={resetLaunchers}
            title={t("Drops custom launchers and every edit.")}
          >
            {t("Reset to defaults")}
          </button>
        </div>
        <Hint>
          {t(
            "Launch from the ⚡ button in the header, the palette, or {key} for the first one. Each opens a new tab in the focused pane's directory.",
            { key: kbd("⌘⇧L") },
          )}
        </Hint>
      </div>
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
        <div className="text-[13px] text-muted">{t("Fleet command")}</div>
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
          <div className="px-3 py-3 rounded-lg border border-dashed border-edge text-[13px] leading-relaxed text-faint">
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
              <div className="text-[14px] text-ink truncate">{p.title}</div>
              <div className="font-mono text-[12px] text-faint whitespace-pre-wrap break-all line-clamp-2">
                {p.text}
              </div>
            </div>
            <button
              className="w-5 h-5 shrink-0 grid place-items-center rounded-md text-[14px] leading-none text-muted opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-white transition-[opacity,background-color,color]"
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
          className="h-7 px-3 rounded-md border border-edge text-[13px] text-muted transition-colors hover:border-accent/40 hover:text-accent"
          onClick={add}
        >
          {t("Add prompt")}
        </button>
      </div>
    </Section>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import {
  usePtyStore,
  activeLeafOf,
  getActiveLeaf,
  attentionPanes,
} from "../../stores/ptyStore";
import { usePromptStore } from "../../stores/promptStore";
import { useUiStore } from "../../stores/uiStore";
import { useSettingsStore, type CursorStyle } from "../../stores/settingsStore";
import { THEMES } from "../../themes";
import { fuzzyMatch } from "../../lib/fuzzy";
import { recentActionIds, recordAction, recencyBoost } from "../../lib/recency";
import { sendTermCmd } from "../../lib/termBus";
import { kbd } from "../../lib/keys";
import { basename } from "../../lib/paths";

interface PaletteAction {
  id: string;
  group: string;
  label: string;
  /** Keyboard hint rendered as a kbd chip. */
  hint?: string;
  /** Small color swatch (themes / accents). */
  swatch?: string;
  /** Marks the currently-active choice with a dot. */
  active?: boolean;
  /** Skip refocusing the terminal after running (action manages focus). */
  keepFocus?: boolean;
  /** Excluded from recent-command tracking (id embeds an ephemeral uuid). */
  transient?: boolean;
  run: () => void;
}

const ACCENT_CHOICES: Array<{ name: string; color: string }> = [
  { name: "Coral", color: "#d97757" },
  { name: "Blue", color: "#82aaff" },
  { name: "Green", color: "#8ec07c" },
  { name: "Violet", color: "#c099ff" },
  { name: "Pink", color: "#f7768e" },
  { name: "Teal", color: "#5eb3b3" },
];

function useActions(): PaletteAction[] {
  const tabs = usePtyStore((s) => s.tabs);
  const activeTabId = usePtyStore((s) => s.activeTabId);
  const themeId = useSettingsStore((s) => s.themeId);
  const accentOverride = useSettingsStore((s) => s.accentOverride);
  const cursorStyle = useSettingsStore((s) => s.cursorStyle);
  const cursorBlink = useSettingsStore((s) => s.cursorBlink);
  const ambientMotion = useSettingsStore((s) => s.ambientMotion);
  const crtMode = useSettingsStore((s) => s.crtMode);
  const notifyLongCommands = useSettingsStore((s) => s.notifyLongCommands);
  const notifyBell = useSettingsStore((s) => s.notifyBell);
  const fleetCommand = useSettingsStore((s) => s.fleetCommand);
  const rightPanelTab = useUiStore((s) => s.rightPanelTab);
  const prompts = usePromptStore((s) => s.prompts);

  return useMemo(() => {
    const pty = () => usePtyStore.getState();
    const ui = () => useUiStore.getState();
    const settings = () => useSettingsStore.getState();

    const actions: PaletteAction[] = [];

    // Panes flagged for attention (bell / long command finished) come
    // first — they're the "why did it ping me" flow.
    const attn = attentionPanes(tabs);
    if (attn.length > 0) {
      actions.push({
        id: "attn-next",
        group: "Agents",
        label: `Go to pane needing attention (${attn.length} waiting)`,
        transient: true,
        run: () => pty().jumpToAttention(),
      });
      for (const { tab, tabIndex, leaf } of attn) {
        const cwd = leaf.cwd ?? leaf.initialCwd;
        actions.push({
          id: `attn-${leaf.id}`,
          group: "Agents",
          label: `${leaf.agentName ?? "shell"} needs attention — tab ${tabIndex + 1}${cwd ? ` · ${basename(cwd) || "/"}` : ""}`,
          transient: true,
          run: () => {
            pty().setActiveTab(tab.id);
            pty().setActivePane(tab.id, leaf.id);
          },
        });
      }
    }

    actions.push({
      id: "agent-overview",
      group: "Agents",
      label: "Agent overview — every pane, state, branch",
      hint: kbd("⌘⇧O"),
      keepFocus: true,
      run: () => ui().setDashboardOpen(true),
    });

    actions.push({
      id: "worktree-modal",
      group: "Agents",
      label: "Worktrees — new agent worktree / manage",
      hint: kbd("⌘⇧N"),
      keepFocus: true,
      run: () => ui().setWorktreeModalOpen(true),
    });

    const activeTab = tabs.find((t) => t.id === activeTabId);
    const activePane = activeTab ? activeLeafOf(activeTab) : null;
    if (activePane && !activePane.exited) {
      actions.push({
        id: "agent-prompt-timer-reset",
        group: "Agents",
        label: "Start/reset prompt timer",
        run: () => pty().markPromptSent(activePane.id),
      });
    }

    // Fleet spawn — clave-style grid + claude-squad-style launch command.
    const fleetCmd = fleetCommand.trim();
    const fleetLabel = fleetCmd ? `running \`${fleetCmd}\`` : "plain shells";
    for (const panes of [2, 4] as const) {
      actions.push({
        id: `fleet-new-${panes}`,
        group: "Agents",
        label: `New fleet tab — ${panes === 2 ? "2 panes" : "2×2 grid"}, ${fleetLabel}`,
        run: () => pty().addFleetTab(panes, fleetCmd || null),
      });
    }

    tabs.forEach((tab, i) => {
      const leaf = activeLeafOf(tab);
      const cwd = leaf.cwd ?? leaf.initialCwd;
      actions.push({
        id: `tab-${tab.id}`,
        group: "Tabs",
        label: `Go to tab ${i + 1} — ${cwd ? basename(cwd) || "/" : "shell"}`,
        hint: i < 9 ? kbd(`⌘${i + 1}`) : undefined,
        active: tab.id === activeTabId,
        transient: true,
        run: () => pty().setActiveTab(tab.id),
      });
    });
    actions.push(
      {
        id: "tab-new",
        group: "Tabs",
        label: "New tab",
        hint: kbd("⌘T"),
        run: () => {
          const leaf = getActiveLeaf();
          pty().addTab(leaf?.cwd ?? leaf?.initialCwd ?? null);
        },
      },
      {
        id: "tab-close",
        group: "Tabs",
        label: "Close current tab",
        run: () => {
          const s = pty();
          if (s.activeTabId) s.closeTab(s.activeTabId);
        },
      },
      {
        id: "tab-next",
        group: "Tabs",
        label: "Next tab",
        hint: kbd("⌘⇧]"),
        run: () => pty().cycleTab(1),
      },
      {
        id: "tab-prev",
        group: "Tabs",
        label: "Previous tab",
        hint: kbd("⌘⇧["),
        run: () => pty().cycleTab(-1),
      },
    );

    actions.push(
      {
        id: "pane-split-right",
        group: "Panes",
        label: "Split pane right",
        hint: kbd("⌘D"),
        run: () => pty().splitPane("row"),
      },
      {
        id: "pane-split-down",
        group: "Panes",
        label: "Split pane down",
        hint: kbd("⌘⇧D"),
        run: () => pty().splitPane("col"),
      },
      {
        id: "pane-close",
        group: "Panes",
        label: "Close pane (last pane closes the tab)",
        hint: kbd("⌘⇧W"),
        run: () => pty().closeActivePane(),
      },
      {
        id: "pane-next",
        group: "Panes",
        label: "Focus next pane",
        run: () => pty().cyclePane(1),
      },
      {
        id: "pane-zoom",
        group: "Panes",
        label: "Toggle pane zoom (maximize)",
        hint: kbd("⌘⇧Z"),
        run: () => pty().toggleZoom(),
      },
      {
        id: "pane-broadcast",
        group: "Panes",
        label: "Toggle broadcast input (type into all panes)",
        hint: kbd("⌘⌥I"),
        active: tabs.find((t) => t.id === activeTabId)?.broadcast ?? false,
        run: () => {
          const s = pty();
          if (s.activeTabId) s.toggleBroadcast(s.activeTabId);
        },
      },
    );

    actions.push(
      {
        id: "term-clear",
        group: "Terminal",
        label: "Clear terminal",
        hint: kbd("⌘K"),
        run: () => sendTermCmd("clear"),
      },
      {
        id: "term-find",
        group: "Terminal",
        label: "Find in scrollback",
        hint: kbd("⌘F"),
        keepFocus: true,
        run: () => sendTermCmd("find"),
      },
      {
        id: "term-bottom",
        group: "Terminal",
        label: "Scroll to bottom",
        run: () => sendTermCmd("scroll-bottom"),
      },
      {
        id: "term-prompt-prev",
        group: "Terminal",
        label: "Jump to previous prompt",
        hint: kbd("⌘↑"),
        run: () => sendTermCmd("prompt-prev"),
      },
      {
        id: "term-prompt-next",
        group: "Terminal",
        label: "Jump to next prompt",
        hint: kbd("⌘↓"),
        run: () => sendTermCmd("prompt-next"),
      },
      {
        id: "term-select-output",
        group: "Terminal",
        label: "Select last command output",
        hint: kbd("⌘⇧A"),
        run: () => sendTermCmd("select-output"),
      },
      {
        id: "term-notify-long",
        group: "Terminal",
        label: "Toggle long-command notifications",
        active: notifyLongCommands,
        run: () => settings().toggleNotifyLongCommands(),
      },
      {
        id: "term-notify-bell",
        group: "Terminal",
        label: "Toggle bell notifications",
        active: notifyBell,
        run: () => settings().toggleNotifyBell(),
      },
      {
        id: "font-up",
        group: "Terminal",
        label: "Increase font size",
        hint: kbd("⌘+"),
        run: () => settings().bumpFontSize(1),
      },
      {
        id: "font-down",
        group: "Terminal",
        label: "Decrease font size",
        hint: kbd("⌘−"),
        run: () => settings().bumpFontSize(-1),
      },
      {
        id: "font-reset",
        group: "Terminal",
        label: "Reset font size",
        hint: kbd("⌘0"),
        run: () => settings().resetFontSize(),
      },
    );

    actions.push(
      {
        id: "view-left",
        group: "View",
        label: "Toggle files sidebar",
        hint: kbd("⌘B"),
        run: () => ui().toggleLeftSidebar(),
      },
      {
        id: "view-right",
        group: "View",
        label: "Toggle assets / review sidebar",
        hint: kbd("⌘J"),
        run: () => ui().toggleRightSidebar(),
      },
      {
        id: "view-assets",
        group: "View",
        label: "Show assets panel",
        active: rightPanelTab === "assets",
        run: () => {
          const s = ui();
          s.setRightPanelTab("assets");
          if (!s.rightSidebarOpen) s.toggleRightSidebar();
        },
      },
      {
        id: "view-review",
        group: "View",
        label: "Show review panel",
        active: rightPanelTab === "review",
        run: () => {
          const s = ui();
          s.setRightPanelTab("review");
          if (!s.rightSidebarOpen) s.toggleRightSidebar();
        },
      },
      {
        id: "view-settings",
        group: "View",
        label: "Open settings",
        hint: kbd("⌘,"),
        keepFocus: true,
        run: () => settings().setPanelOpen(true),
      },
    );

    // Saved prompt snippets (managed in Settings) — inserted through the
    // paste channel so multi-line prompts land as one bracketed paste.
    for (const p of prompts) {
      actions.push({
        id: `prompt-${p.id}`,
        group: "Prompts",
        label: `Insert prompt: ${p.title}`,
        run: () => sendTermCmd({ kind: "paste", text: p.text }),
      });
    }

    for (const theme of THEMES) {
      actions.push({
        id: `theme-${theme.id}`,
        group: "Appearance",
        label: `Theme: ${theme.name}`,
        swatch: theme.ui.accent,
        active: theme.id === themeId,
        run: () => settings().setTheme(theme.id),
      });
    }
    actions.push({
      id: "accent-auto",
      group: "Appearance",
      label: "Accent: Auto (theme default)",
      active: accentOverride === null,
      run: () => settings().setAccentOverride(null),
    });
    for (const a of ACCENT_CHOICES) {
      actions.push({
        id: `accent-${a.name}`,
        group: "Appearance",
        label: `Accent: ${a.name}`,
        swatch: a.color,
        active: a.color.toLowerCase() === accentOverride?.toLowerCase(),
        run: () => settings().setAccentOverride(a.color),
      });
    }
    const cursorStyles: Array<{ id: CursorStyle; name: string }> = [
      { id: "block", name: "Block" },
      { id: "bar", name: "Bar" },
      { id: "underline", name: "Underline" },
    ];
    for (const c of cursorStyles) {
      actions.push({
        id: `cursor-${c.id}`,
        group: "Appearance",
        label: `Cursor: ${c.name}`,
        active: cursorStyle === c.id,
        run: () => settings().setCursorStyle(c.id),
      });
    }
    actions.push(
      {
        id: "fx-cursor-blink",
        group: "Appearance",
        label: "Toggle cursor blink",
        active: cursorBlink,
        run: () => settings().toggleCursorBlink(),
      },
      {
        id: "fx-ambient",
        group: "Appearance",
        label: "Toggle ambient motion",
        active: ambientMotion,
        run: () => settings().toggleAmbientMotion(),
      },
      {
        id: "fx-crt",
        group: "Appearance",
        label: "Toggle CRT mode",
        active: crtMode,
        run: () => settings().toggleCrtMode(),
      },
    );

    return actions;
  }, [
    tabs,
    activeTabId,
    themeId,
    accentOverride,
    cursorStyle,
    cursorBlink,
    ambientMotion,
    crtMode,
    notifyLongCommands,
    notifyBell,
    fleetCommand,
    rightPanelTab,
    prompts,
  ]);
}

export default function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  const actions = useActions();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(0);
    // Next frame so the input exists after the conditional render.
    requestAnimationFrame(() => inputRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        sendTermCmd("focus");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, setOpen]);

  // Re-read once per open (not per keystroke): running an action closes the
  // palette, so the list can only change between opens.
  const recentIds = useMemo(() => (open ? recentActionIds() : []), [open]);

  const results = useMemo(() => {
    if (!query.trim()) {
      const byId = new Map(actions.map((a) => [a.id, a]));
      const recent = recentIds
        .map((id) => byId.get(id))
        .filter((a): a is PaletteAction => a !== undefined)
        .slice(0, 5)
        .map((action) => ({ action, indices: [] as number[], recent: true }));
      return [
        ...recent,
        ...actions.map((action) => ({
          action,
          indices: [] as number[],
          recent: false,
        })),
      ];
    }
    return actions
      .map((action) => {
        const m = fuzzyMatch(query, action.label);
        return m
          ? {
              action,
              indices: m.indices,
              recent: false,
              score: m.score + recencyBoost(action.id, recentIds),
            }
          : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.score - a.score);
  }, [actions, query, recentIds]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected, results.length]);

  if (!open) return null;

  const run = (action: PaletteAction) => {
    setOpen(false);
    if (!action.transient) recordAction(action.id);
    action.run();
    if (!action.keepFocus) sendTermCmd("focus");
  };

  const grouped = !query.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[11vh] bg-black/35 backdrop-blur-[2px] animate-[fade-in_0.1s_ease-out]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          setOpen(false);
          sendTermCmd("focus");
        }
      }}
    >
      <div className="w-[580px] max-w-[92vw] overflow-hidden rounded-2xl border border-edge bg-raise/95 backdrop-blur-xl shadow-[0_24px_80px_rgba(0,0,0,0.55)] animate-[pop-in_0.14s_ease-out]">
        <div className="flex items-center gap-2.5 h-12 px-4 border-b border-edge">
          <span className="font-mono text-accent text-sm shrink-0">❯</span>
          <input
            ref={inputRef}
            type="text"
            spellCheck={false}
            placeholder="Type a command… themes, tabs, effects, anything"
            className="flex-1 bg-transparent font-mono text-[13px] text-ink placeholder:text-faint focus:outline-none"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelected((s) => (s + 1) % Math.max(results.length, 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelected(
                  (s) =>
                    (s - 1 + Math.max(results.length, 1)) %
                    Math.max(results.length, 1),
                );
              } else if (e.key === "Enter") {
                e.preventDefault();
                const r = results[selected];
                if (r) run(r.action);
              }
            }}
          />
          <span className="kbd shrink-0">esc</span>
        </div>

        <div className="max-h-[46vh] overflow-y-auto py-1.5">
          {results.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-faint">
              No matching commands
            </div>
          )}
          {results.map((r, i) => {
            // Recent rows form their own pseudo-group; the same action can
            // appear again below in its real group (hence the key prefix).
            const groupOf = (x: typeof r) =>
              x.recent ? "Recent" : x.action.group;
            const showHeader =
              grouped && (i === 0 || groupOf(results[i - 1]) !== groupOf(r));
            const isSelected = i === selected;
            return (
              <div key={(r.recent ? "recent:" : "") + r.action.id}>
                {showHeader && (
                  <div className="px-4 pt-2.5 pb-1 text-[9.5px] font-semibold uppercase tracking-[0.2em] text-faint">
                    {groupOf(r)}
                  </div>
                )}
                <div
                  ref={isSelected ? selectedRef : undefined}
                  className={`relative mx-1.5 flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors duration-75 ${
                    isSelected
                      ? "bg-accent/[0.13] text-ink"
                      : "text-ink/75 hover:bg-ink/[0.05]"
                  }`}
                  onMouseMove={() => setSelected(i)}
                  onClick={() => run(r.action)}
                >
                  {isSelected && (
                    <span className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-full bg-accent" />
                  )}
                  {r.action.swatch && (
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/20"
                      style={{ backgroundColor: r.action.swatch }}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    <Highlighted text={r.action.label} indices={r.indices} />
                  </span>
                  {r.action.active && (
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                      title="Currently active"
                    />
                  )}
                  {r.action.hint && (
                    <span className="kbd shrink-0">{r.action.hint}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex h-8 items-center gap-3 border-t border-edge px-4 text-[10px] text-faint">
          <span>
            <span className="text-muted">↑↓</span> navigate
          </span>
          <span>
            <span className="text-muted">↩</span> run
          </span>
          <span>
            <span className="text-muted">esc</span> close
          </span>
          <span className="ml-auto font-mono">
            {results.length} command{results.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>
    </div>
  );
}

function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  if (indices.length === 0) return <>{text}</>;
  const set = new Set(indices);
  return (
    <>
      {text.split("").map((ch, i) =>
        set.has(i) ? (
          <span key={i} className="text-accent font-semibold">
            {ch}
          </span>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </>
  );
}

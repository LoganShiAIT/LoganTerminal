import { useEffect, useMemo, useRef, useState } from "react";
import { usePtyStore } from "../../stores/ptyStore";
import { useUiStore } from "../../stores/uiStore";
import { dashboardRows, type DashboardRow } from "../../lib/dashboard";
import { basename } from "../../lib/paths";
import { formatDuration } from "../../lib/duration";
import { sendTermCmd } from "../../lib/termBus";
import { kbd } from "../../lib/keys";

function BranchIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden
      className="shrink-0"
    >
      <circle cx="4.5" cy="3.5" r="1.8" />
      <circle cx="4.5" cy="12.5" r="1.8" />
      <circle cx="11.5" cy="5.5" r="1.8" />
      <path d="M4.5 5.3v5.4M11.5 7.3c0 2.2-3 2.4-5 3" />
    </svg>
  );
}

function stateDotClass(state: DashboardRow["state"]): string {
  switch (state) {
    case "attention":
      return "bg-accent animate-pulse shadow-[0_0_8px_var(--color-accent)]";
    case "agent":
      return "bg-accent";
    case "exited":
      return "bg-red-400/70";
    default:
      return "bg-faint";
  }
}

function stateLabel(row: DashboardRow): string {
  switch (row.state) {
    case "attention":
      return "waiting on you";
    case "agent":
      return "running";
    case "exited":
      return "exited";
    default:
      return "idle";
  }
}

/**
 * Fleet overview (⌘⇧O): every pane across every tab with its agent, state,
 * directory, git branch, and prompt-timer age — claude-squad's session list
 * as a native overlay. ↑↓/Enter or click to jump.
 */
export default function AgentDashboard() {
  const open = useUiStore((s) => s.dashboardOpen);
  const setOpen = useUiStore((s) => s.setDashboardOpen);
  const tabs = usePtyStore((s) => s.tabs);
  const activeTabId = usePtyStore((s) => s.activeTabId);
  const [selected, setSelected] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const selectedRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(
    () => dashboardRows(tabs, activeTabId),
    [tabs, activeTabId],
  );

  const jump = (row: DashboardRow) => {
    const pty = usePtyStore.getState();
    pty.setActiveTab(row.tabId);
    pty.setActivePane(row.tabId, row.paneId);
    setOpen(false);
    requestAnimationFrame(() => sendTermCmd("focus"));
  };

  useEffect(() => {
    if (open) setSelected(0);
  }, [open]);

  // Prompt-timer ages tick while the overlay is up.
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open]);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  useEffect(() => {
    if (!open) return;
    // Capture phase so the focused xterm textarea never sees these keys
    // (same pattern as the settings panel's Esc handling).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        sendTermCmd("focus");
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((s) => (s + 1) % Math.max(rows.length, 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected(
          (s) => (s - 1 + Math.max(rows.length, 1)) % Math.max(rows.length, 1),
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        const row = rows[selected];
        if (row) jump(row);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, rows, selected]);

  if (!open) return null;

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
      <div className="w-[640px] max-w-[94vw] overflow-hidden rounded-2xl border border-edge bg-raise/95 backdrop-blur-xl shadow-[0_24px_80px_rgba(0,0,0,0.55)] animate-[pop-in_0.14s_ease-out]">
        <div className="flex items-center gap-2.5 h-11 px-4 border-b border-edge">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
            Agents
          </span>
          <span className="font-mono text-[10px] text-faint">
            {rows.length} pane{rows.length === 1 ? "" : "s"} ·{" "}
            {rows.filter((r) => r.state === "attention").length} waiting
          </span>
          <span className="ml-auto kbd shrink-0">esc</span>
        </div>

        <div className="max-h-[52vh] overflow-y-auto py-1.5">
          {rows.map((row, i) => {
            const isSelected = i === selected;
            const name = row.agentName ?? "shell";
            const where = row.title || (row.cwd ? basename(row.cwd) : null);
            const age =
              row.lastPromptSentAt !== null
                ? formatDuration(Math.max(0, now - row.lastPromptSentAt))
                : null;
            return (
              <div
                key={row.paneId}
                ref={isSelected ? selectedRef : undefined}
                className={`relative mx-1.5 flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[12px] transition-colors duration-75 ${
                  isSelected
                    ? "bg-accent/[0.13] text-ink"
                    : "text-ink/75 hover:bg-ink/[0.05]"
                }`}
                onMouseMove={() => setSelected(i)}
                onClick={() => jump(row)}
              >
                {isSelected && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-full bg-accent" />
                )}
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${stateDotClass(row.state)}`}
                />
                <span className="font-mono text-[10px] text-faint shrink-0 w-8">
                  tab {row.tabIndex + 1}
                </span>
                <span
                  className={`font-semibold shrink-0 ${
                    row.agentName ? "text-accent" : "text-muted"
                  }`}
                >
                  {name}
                </span>
                {where && (
                  <span className="truncate font-mono text-[11px] text-muted">
                    {where}
                  </span>
                )}
                {row.gitBranch && (
                  <span className="flex items-center gap-1 shrink-0 px-1.5 py-0.5 rounded-full border border-edge bg-ink/5 font-mono text-[10px] text-muted">
                    <BranchIcon />
                    <span className="max-w-[120px] truncate">
                      {row.gitBranch}
                    </span>
                  </span>
                )}
                <span className="ml-auto flex items-center gap-2 shrink-0">
                  {row.unread && !row.watched && (
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-ink/50"
                      title="Unseen output"
                    />
                  )}
                  {age && (
                    <span
                      className="font-mono text-[10px] text-faint"
                      title="Since last prompt to this agent"
                    >
                      {age}
                    </span>
                  )}
                  <span
                    className={`font-mono text-[10px] ${
                      row.state === "attention"
                        ? "text-accent"
                        : row.state === "exited"
                          ? "text-red-300/80"
                          : "text-faint"
                    }`}
                  >
                    {stateLabel(row)}
                  </span>
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3 h-8 px-4 border-t border-edge text-[10px] text-faint">
          <span>↑↓ select</span>
          <span>↵ jump</span>
          <span className="ml-auto">{kbd("⌘⇧O")}</span>
        </div>
      </div>
    </div>
  );
}

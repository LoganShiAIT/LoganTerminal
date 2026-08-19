import { useEffect, useMemo, useState } from "react";
import { usePtyStore } from "../../stores/ptyStore";
import { useUiStore } from "../../stores/uiStore";
import { dashboardRows, type DashboardRow } from "../../lib/dashboard";
import { basename } from "../../lib/paths";
import { useEscapeClose } from "../../lib/useEscapeClose";
import { useListSelection } from "../../lib/useListSelection";
import { formatDuration } from "../../lib/duration";
import { sendTermCmd } from "../../lib/termBus";
import { kbd } from "../../lib/keys";
import { t, useT } from "../../i18n";
import {
  Overlay,
  OverlayHeader,
  OverlayList,
  OverlayRow,
  OverlayFooter,
} from "../Overlay/Overlay";
import { BranchIcon } from "../icons";
import GitDirtyCounts from "../GitDirtyCounts";

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
      return t("waiting on you");
    case "agent":
      return t("running");
    case "exited":
      return t("exited");
    default:
      return t("idle");
  }
}

function stateTextClass(state: DashboardRow["state"]): string {
  switch (state) {
    case "attention":
      return "text-accent";
    case "exited":
      return "text-red-300/80";
    default:
      return "text-faint";
  }
}

/**
 * Fleet overview (⌘⇧O): every pane across every tab with its agent, state,
 * directory, git branch, and prompt-timer age — claude-squad's session list
 * as a native overlay. ↑↓/Enter or click to jump.
 */
export default function AgentDashboard() {
  const t = useT();
  const open = useUiStore((s) => s.dashboardOpen);
  const setOpen = useUiStore((s) => s.setDashboardOpen);
  const tabs = usePtyStore((s) => s.tabs);
  const activeTabId = usePtyStore((s) => s.activeTabId);
  const [now, setNow] = useState(() => Date.now());

  const rows = useMemo(
    () => dashboardRows(tabs, activeTabId),
    [tabs, activeTabId],
  );

  const close = () => {
    setOpen(false);
    sendTermCmd("focus");
  };

  const jump = (row: DashboardRow) => {
    const pty = usePtyStore.getState();
    pty.setActiveTab(row.tabId);
    pty.setActivePane(row.tabId, row.paneId);
    setOpen(false);
    requestAnimationFrame(() => sendTermCmd("focus"));
  };

  const { selected, setSelected, selectedRef, handleKey } = useListSelection(
    rows.length,
    (i) => {
      const row = rows[i];
      if (row) jump(row);
    },
  );

  useEffect(() => {
    if (open) setSelected(0);
  }, [open, setSelected]);

  // Prompt-timer ages tick while the overlay is up.
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open]);

  useEscapeClose(open, close);

  useEffect(() => {
    if (!open) return;
    // Capture phase so the focused xterm textarea never sees these keys.
    const onKey = (e: KeyboardEvent) => {
      if (handleKey(e)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, handleKey]);

  if (!open) return null;

  return (
    <Overlay width={640} onClose={close}>
      <OverlayHeader
        title={t("Agents")}
        note={t("{panes} panes · {waiting} waiting", {
          panes: rows.length,
          waiting: rows.filter((r) => r.state === "attention").length,
        })}
      />

      <OverlayList max="52vh">
        {rows.map((row, i) => {
          const where = row.title || (row.cwd ? basename(row.cwd) : null);
          const age =
            row.agentIdleSinceAt !== null
              ? formatDuration(Math.max(0, now - row.agentIdleSinceAt))
              : null;
          return (
            <OverlayRow
              key={row.paneId}
              compact
              selected={i === selected}
              rowRef={selectedRef}
              onSelect={() => setSelected(i)}
              onActivate={() => jump(row)}
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${stateDotClass(row.state)}`}
              />
              <span className="font-mono text-[12px] text-faint shrink-0 w-8">
                tab {row.tabIndex + 1}
              </span>
              <span
                className={`font-semibold shrink-0 ${
                  row.agentName ? "text-accent" : "text-muted"
                }`}
              >
                {row.agentName ?? "shell"}
              </span>
              {where && (
                <span className="truncate font-mono text-[13px] text-muted">
                  {where}
                </span>
              )}
              {row.gitBranch && (
                <span className="flex items-center gap-1 shrink-0 px-1.5 py-0.5 rounded-full border border-edge bg-ink/5 font-mono text-[12px] text-muted">
                  <BranchIcon />
                  <span className="max-w-[120px] truncate">{row.gitBranch}</span>
                  <GitDirtyCounts
                    dirty={row.gitDirty}
                    title={t("Uncommitted changes: new / modified / deleted")}
                  />
                </span>
              )}
              <span className="ml-auto flex items-center gap-2 shrink-0">
                {row.unread && !row.watched && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-ink/50"
                    title={t("Unseen output")}
                  />
                )}
                {age && (
                  <span
                    className="font-mono text-[12px] text-faint"
                    title={t("Waiting on you since this agent went idle")}
                  >
                    {age}
                  </span>
                )}
                <span className={`font-mono text-[12px] ${stateTextClass(row.state)}`}>
                  {stateLabel(row)}
                </span>
              </span>
            </OverlayRow>
          );
        })}
      </OverlayList>

      <OverlayFooter>
        <span>↑↓ select</span>
        <span>↵ jump</span>
        <span className="ml-auto">{kbd("⌘⇧O")}</span>
      </OverlayFooter>
    </Overlay>
  );
}

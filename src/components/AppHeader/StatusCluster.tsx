import { useEffect, useState, type CSSProperties } from "react";
import {
  usePtyStore,
  useActiveTab,
  useActivePane,
  attentionPanes,
  type LeafPane,
} from "../../stores/ptyStore";
import { useUiStore } from "../../stores/uiStore";
import { formatDuration } from "../../lib/duration";
import { homeDir, tildify } from "../../lib/paths";
import { sendTermCmd } from "../../lib/termBus";
import { kbd } from "../../lib/keys";
import { dirtyTotal } from "../../lib/git";
import { useT } from "../../i18n";
import { BranchIcon, ClockIcon } from "../icons";
import GitDirtyCounts from "../GitDirtyCounts";

/** How long Claude keeps a prompt cache warm — what the idle bar fills to. */
const CLAUDE_CACHE_WINDOW_MS = 5 * 60 * 1000;

/** A command has to take at least this long before its duration is worth showing. */
const SLOW_COMMAND_MS = 2000;

const CHIP =
  "flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-mono border";

/**
 * The right-hand end of the header: everything worth knowing about the
 * focused pane, in the order it becomes interesting. Each chip follows the
 * same rule — say nothing when there is nothing anomalous to say.
 */
export default function StatusCluster() {
  const activeTab = useActiveTab();
  const pane = useActivePane();
  const attnCount = usePtyStore((s) => attentionPanes(s.tabs).length);

  return (
    <div className="ml-auto flex items-center gap-2.5 shrink-0">
      {activeTab?.broadcast && <BroadcastChip tabId={activeTab.id} />}
      {attnCount > 0 && <AttentionChip count={attnCount} />}
      {pane && <BranchChip pane={pane} />}
      {pane && <AgentChip pane={pane} />}
      {pane && <IdleTimerChip pane={pane} />}
      {pane && <CommandResultChips pane={pane} />}
      <SessionChip pane={pane} hasTab={Boolean(activeTab)} />
    </div>
  );
}

function BroadcastChip({ tabId }: { tabId: string }) {
  const t = useT();
  return (
    <button
      className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[12px] font-semibold uppercase tracking-[0.14em] text-white bg-accent border border-accent shadow-[0_0_10px_color-mix(in_srgb,var(--color-accent)_45%,transparent)]"
      onClick={() => usePtyStore.getState().toggleBroadcast(tabId)}
      title={t(
        "Broadcast is ON — keystrokes go to every pane in this tab. Click to turn off.",
      )}
    >
      ⇶ {t("broadcast")}
    </button>
  );
}

function AttentionChip({ count }: { count: number }) {
  const t = useT();
  return (
    <button
      className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[12px] font-mono font-semibold text-accent bg-accent/15 border border-accent/40 hover:bg-accent hover:text-white transition-colors"
      onClick={() => {
        usePtyStore.getState().jumpToAttention();
        requestAnimationFrame(() => sendTermCmd("focus"));
      }}
      title={t(
        "Panes waiting on you (bell / long command done) — click to jump, {key} for the full overview",
        { key: kbd("⌘⇧O") },
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
      {t("{n} waiting", { n: count })}
    </button>
  );
}

function BranchChip({ pane }: { pane: LeafPane }) {
  const t = useT();
  if (!pane.gitBranch || pane.exited) return null;
  const where = pane.cwd ?? t("cwd");
  const dirty = pane.gitDirty;
  const summary =
    dirty && dirtyTotal(dirty) > 0
      ? t(" · uncommitted: {added} new, {modified} modified, {deleted} deleted", {
          added: dirty.added,
          modified: dirty.modified,
          deleted: dirty.deleted,
        })
      : t(" · clean");

  return (
    <button
      className={`${CHIP} text-muted bg-ink/5 border-edge max-w-[200px] hover:text-accent hover:border-accent/35 transition-colors`}
      onClick={() => useUiStore.getState().openSidebarPanel("diff")}
      title={
        t("Git branch of {where}", { where }) +
        summary +
        t(" — click for the diff panel ({key})", { key: kbd("⌘⇧G") })
      }
    >
      <BranchIcon />
      <span className="truncate">{pane.gitBranch}</span>
      <GitDirtyCounts dirty={dirty} />
    </button>
  );
}

function AgentChip({ pane }: { pane: LeafPane }) {
  const t = useT();
  if (!pane.agentName || pane.exited) return null;
  return (
    <span
      className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[12px] font-semibold uppercase tracking-[0.14em] text-accent bg-accent/15 border border-accent/40"
      title={t("Detected agent: {name}", { name: pane.agentName })}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
      {pane.agentName}
    </span>
  );
}

/**
 * The clock runs on the *user's* turn: it starts when the agent finishes
 * answering and goes quiet, and stops the moment work resumes — that idle
 * stretch is what the prompt-cache window actually measures.
 */
function IdleTimerChip({ pane }: { pane: LeafPane }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  const live = Boolean(pane.sessionId) && !pane.exited;
  const idleSince = pane.agentIdleSinceAt;

  useEffect(() => {
    if (!live || idleSince === null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [live, idleSince]);

  if (!live) return null;

  const agentWorking = pane.busy;
  const elapsed = idleSince ? Math.max(0, now - idleSince) : null;
  const progress =
    elapsed === null ? 0 : Math.min(100, (elapsed / CLAUDE_CACHE_WINDOW_MS) * 100);
  const cacheOpen = elapsed !== null && elapsed < CLAUDE_CACHE_WINDOW_MS;

  return (
    <button
      className={`group relative isolate flex h-6 min-w-[86px] items-center gap-1.5 overflow-hidden rounded-full border px-2 font-mono text-[12px] transition-colors ${
        idleSince
          ? cacheOpen
            ? "border-accent/40 text-accent bg-accent/10 hover:bg-accent/15"
            : "border-edge text-muted bg-ink/5 hover:text-accent hover:border-accent/35"
          : "border-edge text-faint bg-ink/5 hover:text-accent hover:border-accent/35"
      }`}
      style={
        idleSince
          ? ({ "--prompt-progress": `${progress}%` } as CSSProperties)
          : undefined
      }
      onClick={() => usePtyStore.getState().markAgentIdle(pane.id)}
      title={
        idleSince
          ? (cacheOpen ? t("Claude cache window") : t("Cache window passed")) +
            t(" · since the agent last finished · click to reset")
          : agentWorking
            ? t("Agent is working — the timer starts when it goes idle")
            : t("Start idle timer")
      }
    >
      {idleSince && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 -z-10 w-[var(--prompt-progress)] bg-accent/15 transition-[width] duration-300"
        />
      )}
      <ClockIcon />
      <span>
        {elapsed !== null
          ? formatDuration(elapsed)
          : agentWorking
            ? t("working")
            : t("timer")}
      </span>
    </button>
  );
}

/**
 * Anomalies only: a clean exit and a quick command both say nothing. Both
 * require zsh/bash shell integration (OSC 133) and are silently absent
 * otherwise.
 */
function CommandResultChips({ pane }: { pane: LeafPane }) {
  const t = useT();
  if (pane.exited) return null;
  const failed = pane.lastExitCode != null && pane.lastExitCode !== 0;
  const slow =
    pane.lastDurationMs != null && pane.lastDurationMs >= SLOW_COMMAND_MS;
  return (
    <>
      {failed && (
        <span
          className={`${CHIP} font-semibold text-red-300 bg-red-500/15 border-red-400/40`}
          title={t("Last command's exit status")}
        >
          exit {pane.lastExitCode}
        </span>
      )}
      {slow && (
        <span
          className={`${CHIP} text-muted bg-ink/5 border-edge`}
          title={t("Last command's duration")}
        >
          {formatDuration(pane.lastDurationMs!)}
        </span>
      )}
    </>
  );
}

/** Liveness dot plus the current directory — the always-present anchor. */
function SessionChip({
  pane,
  hasTab,
}: {
  pane: LeafPane | undefined;
  hasTab: boolean;
}) {
  const t = useT();
  const [home, setHome] = useState<string | null>(null);

  useEffect(() => {
    homeDir()
      .then(setHome)
      .catch(() => {});
  }, []);

  const exited = Boolean(pane?.exited);
  const live = Boolean(pane?.sessionId) && !exited;
  const cwd = pane?.cwd ?? null;

  return (
    <span
      className="flex items-center gap-1.5 font-mono text-[13px] text-muted"
      title={
        pane?.sessionId
          ? t("session {id}", { id: pane.sessionId.slice(0, 8) }) +
            (cwd ? ` · ${cwd}` : "")
          : undefined
      }
    >
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${
          live
            ? "bg-accent shadow-[0_0_8px_var(--color-accent)]"
            : exited
              ? "bg-red-400/70"
              : "bg-faint"
        }`}
      />
      <span className="truncate max-w-[240px]">
        {exited
          ? t("exited — {key} to close", { key: kbd("⌘⇧W") })
          : live
            ? cwd
              ? tildify(cwd, home)
              : t("shell")
            : hasTab
              ? t("starting…")
              : t("no session")}
      </span>
    </span>
  );
}

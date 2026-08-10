import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useActivePane } from "../../stores/ptyStore";
import { useUiStore } from "../../stores/uiStore";
import {
  dirtyTotal,
  type CommitLog as Log,
  type DiffFile,
  type DiffSummary,
  type DiffView,
} from "../../lib/git";
import DiffFileTree from "./DiffFileTree";
import CommitLog from "./CommitLog";
import { useT } from "../../i18n";

/** How far back the history view reads. Deep enough to see a fork, cheap. */
const LOG_LIMIT = 120;

function RefreshIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 1.5v3h-3" />
    </svg>
  );
}

/**
 * Git review panel for the active pane's repository, in three views:
 * "Changes" = uncommitted work vs HEAD plus untracked files; "vs <base>" =
 * what this branch carries beyond the main worktree's branch (the review
 * surface for ⌘⇧N agent worktrees); "History" = the commit graph behind them.
 * Auto-refreshes on every prompt (the same OSC 7 tick that refreshes the
 * branch chip), skipped while the sidebar is hidden.
 */
export default function DiffPanel() {
  const t = useT();
  const pane = useActivePane();
  const sidebarOpen = useUiStore((s) => s.rightSidebarOpen);
  const cwd = pane?.cwd ?? pane?.initialCwd ?? null;
  const branch = pane?.gitBranch ?? null;
  const dirty = pane?.gitDirty ?? null;

  const [view, setView] = useState<DiffView>("working");
  const [summary, setSummary] = useState<DiffSummary | null>(null);
  const [log, setLog] = useState<Log | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by every successful load: the open patch refetches with it, since
  // the commit or worktree state underneath it may have moved.
  const [tick, setTick] = useState(0);

  // Every prompt bumps this signature via the pane's gitDirty refresh — the
  // cheap way to know "something may have changed on disk".
  const dirtySig = dirty
    ? `${dirty.added}/${dirty.modified}/${dirty.deleted}`
    : "clean";

  // Guards against an older, slower load resolving after a newer one (pane
  // switch or view flip while a big diff is still being computed).
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    if (!cwd) {
      setSummary(null);
      setLog(null);
      setError(null);
      return;
    }
    const seq = ++loadSeq.current;
    try {
      if (view === "log") {
        const l = await invoke<Log>("git_log", { cwd, limit: LOG_LIMIT });
        if (loadSeq.current !== seq) return;
        setLog(l);
      } else {
        const s = await invoke<DiffSummary>("git_diff_summary", { cwd, mode: view });
        if (loadSeq.current !== seq) return;
        setSummary(s);
      }
      setError(null);
      setTick((n) => n + 1);
    } catch (e) {
      if (loadSeq.current !== seq) return;
      setSummary(null);
      setLog(null);
      setError(String(e));
    }
  }, [cwd, view]);

  useEffect(() => {
    if (!sidebarOpen) return;
    void load();
    // dirtySig/branch aren't read by load(); they're the refresh triggers.
  }, [load, sidebarOpen, dirtySig, branch]);

  const loadPatch = useCallback(
    (file: DiffFile) =>
      invoke<string>("git_diff_file", {
        cwd,
        mode: view,
        path: file.path,
        untracked: file.untracked,
      }),
    [cwd, view],
  );

  const segBtn = (active: boolean) =>
    `h-full min-w-0 flex-1 truncate rounded-md px-1 text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors ${
      active ? "text-accent bg-accent/15 border border-accent/30" : "text-muted hover:text-ink"
    }`;

  const empty = (message: string) => (
    <div className="rounded-lg border border-dashed border-edge px-3 py-3 text-[11px] leading-relaxed text-faint">
      {message}
    </div>
  );

  const body = () => {
    if (!cwd) return empty(t("No active shell directory yet."));
    if (error) {
      return (
        <div className="rounded-lg border border-dashed border-edge px-3 py-3 font-mono text-[10px] leading-relaxed break-all whitespace-pre-wrap text-faint">
          {error}
        </div>
      );
    }
    if (view === "log") {
      return log && <CommitLog key={cwd} cwd={cwd} log={log} />;
    }
    if (!summary) return null;
    if (summary.files.length === 0) {
      return empty(
        view === "working"
          ? t("Working tree clean — nothing uncommitted.")
          : t("No commits beyond {base}.", { base: summary.base ?? t("the base branch") }),
      );
    }
    return (
      <DiffFileTree
        key={`${cwd}:${view}`}
        files={summary.files}
        root={summary.root}
        loadPatch={loadPatch}
        reloadKey={tick}
      />
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-2 border-b border-edge p-2">
        <div className="flex h-7 items-center gap-1 rounded-lg bg-ink/[0.05] p-0.5">
          <button className={segBtn(view === "working")} onClick={() => setView("working")}>
            {t("Changes")}
          </button>
          <button className={segBtn(view === "branch")} onClick={() => setView("branch")}>
            {t("vs {base}", { base: summary?.base ?? log?.base ?? "main" })}
          </button>
          <button className={segBtn(view === "log")} onClick={() => setView("log")}>
            {t("History")}
          </button>
          <button
            className="grid h-full w-7 shrink-0 place-items-center rounded-md text-muted transition-colors hover:text-accent"
            onClick={() => void load()}
            title={t("Refresh (also refreshes on every prompt)")}
          >
            <RefreshIcon />
          </button>
        </div>
        {branch && (
          <div className="flex items-center gap-2 px-1 font-mono text-[10px] text-faint">
            <span className="truncate text-muted">{branch}</span>
            {dirtyTotal(dirty) > 0 && (
              <span className="flex shrink-0 items-center gap-1">
                {dirty!.added > 0 && <span className="text-emerald-300/90">+{dirty!.added}</span>}
                {dirty!.modified > 0 && <span className="text-amber-300/90">~{dirty!.modified}</span>}
                {dirty!.deleted > 0 && <span className="text-red-300/90">−{dirty!.deleted}</span>}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">{body()}</div>
    </div>
  );
}

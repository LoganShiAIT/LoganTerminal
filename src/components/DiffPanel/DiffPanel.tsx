import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useActivePane } from "../../stores/ptyStore";
import { useUiStore } from "../../stores/uiStore";
import {
  classifyDiffLine,
  dirtyTotal,
  type DiffFile,
  type DiffLineKind,
  type DiffMode,
  type DiffSummary,
} from "../../lib/git";
import { basename } from "../../lib/paths";

const LINE_CLASS: Record<DiffLineKind, string> = {
  add: "text-emerald-300 bg-emerald-500/[0.07]",
  del: "text-red-300 bg-red-500/[0.07]",
  hunk: "text-accent/90 bg-accent/[0.06]",
  meta: "text-faint",
  ctx: "text-muted",
};

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

function Patch({ text }: { text: string }) {
  if (!text.trim()) {
    return (
      <div className="px-3 py-2 text-[10px] text-faint">
        No textual changes (empty or binary file).
      </div>
    );
  }
  return (
    <pre className="overflow-x-auto px-1 py-1 font-mono text-[10px] leading-[1.5]">
      {text.split("\n").map((line, i) => (
        <div
          key={i}
          className={`px-2 whitespace-pre ${LINE_CLASS[classifyDiffLine(line)]}`}
        >
          {line || " "}
        </div>
      ))}
    </pre>
  );
}

/**
 * Git diff review panel: what changed in the active pane's repository.
 * "Changes" = uncommitted work vs HEAD plus untracked files; "vs <base>" =
 * commits this branch carries beyond the main worktree's branch — the
 * review surface for ⌘⇧N agent worktrees. Auto-refreshes on every prompt
 * (the same OSC 7 tick that refreshes the branch chip), skipped while the
 * sidebar is hidden.
 */
export default function DiffPanel() {
  const pane = useActivePane();
  const sidebarOpen = useUiStore((s) => s.rightSidebarOpen);
  const cwd = pane?.cwd ?? pane?.initialCwd ?? null;
  const branch = pane?.gitBranch ?? null;
  const dirty = pane?.gitDirty ?? null;

  const [mode, setMode] = useState<DiffMode>("working");
  const [summary, setSummary] = useState<DiffSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [patch, setPatch] = useState<string | null>(null);
  const [patchError, setPatchError] = useState<string | null>(null);

  // Every prompt bumps this signature via the pane's gitDirty refresh — the
  // cheap way to know "something may have changed on disk".
  const dirtySig = dirty
    ? `${dirty.added}/${dirty.modified}/${dirty.deleted}`
    : "clean";

  // Guards against an older, slower summary resolving after a newer one
  // (pane switch or mode flip while a big diff is still being computed).
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    if (!cwd) {
      setSummary(null);
      setError(null);
      return;
    }
    const seq = ++loadSeq.current;
    try {
      const s = await invoke<DiffSummary>("git_diff_summary", { cwd, mode });
      if (loadSeq.current !== seq) return;
      setSummary(s);
      setError(null);
    } catch (e) {
      if (loadSeq.current !== seq) return;
      setSummary(null);
      setError(String(e));
    }
  }, [cwd, mode]);

  useEffect(() => {
    if (!sidebarOpen) return;
    void load();
    // dirtySig/branch aren't read by load(); they're the refresh triggers.
  }, [load, sidebarOpen, dirtySig, branch]);

  // The open file's patch loads on selection and reloads with each summary
  // (same DOM node stays mounted, so scroll position survives the swap).
  useEffect(() => {
    if (!openPath || !cwd) {
      setPatch(null);
      setPatchError(null);
      return;
    }
    if (!summary) return;
    const file = summary.files.find((f) => f.path === openPath);
    if (!file) {
      // Committed/cleaned away since selection.
      setOpenPath(null);
      return;
    }
    let cancelled = false;
    invoke<string>("git_diff_file", {
      cwd,
      mode,
      path: file.path,
      untracked: file.untracked,
    })
      .then((p) => {
        if (cancelled) return;
        setPatch(p);
        setPatchError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setPatch(null);
        setPatchError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [openPath, cwd, mode, summary]);

  // Pane hopped to another directory: keep the panel but drop the selection.
  useEffect(() => {
    setOpenPath(null);
  }, [cwd]);

  const segBtn = (active: boolean) =>
    `h-full flex-1 rounded-md text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors ${
      active ? "text-accent bg-accent/15 border border-accent/30" : "text-muted hover:text-ink"
    }`;

  const fileStat = (f: DiffFile) => {
    if (f.untracked) {
      return <span className="text-emerald-300/90 text-[9px] uppercase">new</span>;
    }
    if (f.additions === null && f.deletions === null) {
      return <span className="text-faint text-[9px] uppercase">bin</span>;
    }
    return (
      <>
        {(f.additions ?? 0) > 0 && (
          <span className="text-emerald-300/90">+{f.additions}</span>
        )}
        {(f.deletions ?? 0) > 0 && (
          <span className="text-red-300/90">−{f.deletions}</span>
        )}
      </>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-2 border-b border-edge p-2">
        <div className="flex h-7 items-center gap-1 rounded-lg bg-ink/[0.05] p-0.5">
          <button className={segBtn(mode === "working")} onClick={() => setMode("working")}>
            Changes
          </button>
          <button className={segBtn(mode === "branch")} onClick={() => setMode("branch")}>
            vs {summary?.base ?? "main"}
          </button>
          <button
            className="grid h-full w-7 shrink-0 place-items-center rounded-md text-muted transition-colors hover:text-accent"
            onClick={() => void load()}
            title="Refresh (also refreshes on every prompt)"
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

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!cwd ? (
          <div className="rounded-lg border border-dashed border-edge px-3 py-3 text-[11px] leading-relaxed text-faint">
            No active shell directory yet.
          </div>
        ) : error ? (
          <div className="rounded-lg border border-dashed border-edge px-3 py-3 font-mono text-[10px] leading-relaxed text-faint whitespace-pre-wrap break-all">
            {error}
          </div>
        ) : !summary ? null : summary.files.length === 0 ? (
          <div className="rounded-lg border border-dashed border-edge px-3 py-3 text-[11px] leading-relaxed text-faint">
            {mode === "working"
              ? "Working tree clean — nothing uncommitted."
              : `No commits beyond ${summary.base ?? "the base branch"}.`}
          </div>
        ) : (
          <div className="space-y-1">
            {summary.files.map((f) => {
              const open = f.path === openPath;
              const dir = f.path.includes("/")
                ? f.path.slice(0, f.path.length - basename(f.path).length)
                : "";
              return (
                <div
                  key={`${f.untracked ? "u:" : ""}${f.path}`}
                  className={`overflow-hidden rounded-lg border transition-colors ${
                    open ? "border-accent/30 bg-ink/[0.03]" : "border-edge bg-ink/[0.03]"
                  }`}
                >
                  <button
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-ink/[0.04]"
                    onClick={() => setOpenPath(open ? null : f.path)}
                    title={f.path}
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                      {dir && <span className="text-faint">{dir}</span>}
                      <span className="text-ink">{basename(f.path)}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px]">
                      {fileStat(f)}
                    </span>
                  </button>
                  {open && (
                    <div className="border-t border-edge">
                      {patchError ? (
                        <div className="px-3 py-2 font-mono text-[10px] text-red-300 whitespace-pre-wrap break-all">
                          {patchError}
                        </div>
                      ) : patch === null ? (
                        <div className="px-3 py-2 text-[10px] text-faint">Loading…</div>
                      ) : (
                        <Patch text={patch} />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

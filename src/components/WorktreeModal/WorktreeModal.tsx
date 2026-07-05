import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePtyStore, getActiveLeaf } from "../../stores/ptyStore";
import { useUiStore } from "../../stores/uiStore";
import { useSettingsStore } from "../../stores/settingsStore";
import {
  sanitizeTask,
  type WorktreeCreated,
  type WorktreeEntry,
} from "../../lib/worktree";
import { basename } from "../../lib/paths";
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

/**
 * Worktree flows (⌘⇧N): task name → sibling worktree + branch → agent tab
 * (claude-squad's task-isolation model). The same surface lists existing
 * worktrees to open or remove; removal is non-force only — git refusing a
 * dirty tree is the safety rail.
 */
export default function WorktreeModal() {
  const open = useUiStore((s) => s.worktreeModalOpen);
  const setOpen = useUiStore((s) => s.setWorktreeModalOpen);
  const fleetCommand = useSettingsStore((s) => s.fleetCommand);
  const [task, setTask] = useState("");
  const [runAgent, setRunAgent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<WorktreeEntry[] | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const cwdOf = () => {
    const leaf = getActiveLeaf();
    return leaf?.cwd ?? leaf?.initialCwd ?? null;
  };

  const refresh = async () => {
    const cwd = cwdOf();
    if (!cwd) {
      setRepoError("No active shell directory yet.");
      setEntries(null);
      return;
    }
    try {
      setEntries(await invoke<WorktreeEntry[]>("git_worktree_list", { cwd }));
      setRepoError(null);
    } catch (e) {
      setEntries(null);
      setRepoError(String(e));
    }
  };

  useEffect(() => {
    if (!open) return;
    setTask("");
    setError(null);
    setBusy(false);
    setRunAgent(true);
    void refresh();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Capture phase so the focused xterm textarea never sees Esc.
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

  if (!open) return null;

  const branch = sanitizeTask(task);
  const mainPath = entries?.find((e) => e.is_main)?.path ?? null;
  const repoName = mainPath ? basename(mainPath) : null;
  const cmd = fleetCommand.trim();
  const canCreate = Boolean(branch) && !busy && !repoError;

  const close = () => {
    setOpen(false);
    sendTermCmd("focus");
  };

  const create = async () => {
    const cwd = cwdOf();
    if (!cwd || !branch || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await invoke<WorktreeCreated>("git_worktree_add", {
        cwd,
        task,
      });
      usePtyStore.getState().addTab(created.path, runAgent && cmd ? cmd : null);
      close();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const openEntry = (path: string) => {
    usePtyStore.getState().addTab(path);
    close();
  };

  const removeEntry = async (path: string) => {
    const cwd = mainPath ?? cwdOf();
    if (!cwd || busy) return;
    setBusy(true);
    setError(null);
    try {
      await invoke("git_worktree_remove", { cwd, path });
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const field =
    "w-full rounded-lg border border-edge bg-ink/[0.04] px-2.5 py-1.5 font-mono text-[12px] text-ink placeholder:text-faint focus:outline-none focus:border-accent/50";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[11vh] bg-black/35 backdrop-blur-[2px] animate-[fade-in_0.1s_ease-out]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="w-[560px] max-w-[94vw] overflow-hidden rounded-2xl border border-edge bg-raise/95 backdrop-blur-xl shadow-[0_24px_80px_rgba(0,0,0,0.55)] animate-[pop-in_0.14s_ease-out]">
        <div className="flex items-center gap-2.5 h-11 px-4 border-b border-edge">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
            Worktrees
          </span>
          {repoName && (
            <span className="font-mono text-[10px] text-faint">{repoName}</span>
          )}
          <span className="ml-auto kbd shrink-0">esc</span>
        </div>

        <div className="p-4 space-y-3">
          {repoError ? (
            <div className="px-3 py-3 rounded-lg border border-dashed border-edge text-[11px] leading-relaxed text-faint">
              {repoError}
            </div>
          ) : (
            <>
              <input
                ref={inputRef}
                value={task}
                onChange={(e) => setTask(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void create();
                  }
                }}
                placeholder="Task name — e.g. fix-login, 重构侧栏"
                spellCheck={false}
                className={field}
              />
              <div className="flex items-center gap-2 font-mono text-[10px] text-faint min-h-4">
                {branch ? (
                  <>
                    <span className="flex items-center gap-1 text-muted">
                      <BranchIcon />
                      {branch}
                    </span>
                    {repoName && (
                      <span className="truncate">
                        …/{repoName}-worktrees/{branch}
                      </span>
                    )}
                  </>
                ) : task.trim() ? (
                  <span>Nothing usable in that name yet.</span>
                ) : (
                  <span>
                    Creates a sibling worktree on a new branch — agents work in
                    parallel without touching your checkout.
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {cmd && (
                  <label className="flex items-center gap-1.5 text-[11px] text-muted cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={runAgent}
                      onChange={(e) => setRunAgent(e.target.checked)}
                      style={{ accentColor: "var(--color-accent)" }}
                    />
                    run <span className="font-mono text-ink">{cmd}</span> in it
                  </label>
                )}
                <button
                  className={`ml-auto h-7 px-3 rounded-md border text-[11px] transition-colors ${
                    canCreate
                      ? "border-accent/50 text-accent hover:bg-accent hover:text-white"
                      : "border-edge text-faint cursor-default"
                  }`}
                  onClick={() => void create()}
                  disabled={!canCreate}
                >
                  {busy ? "Working…" : "Create worktree"}
                </button>
              </div>
            </>
          )}

          {error && (
            <div className="px-3 py-2 rounded-lg border border-red-400/40 bg-red-500/10 font-mono text-[10px] leading-relaxed text-red-300 whitespace-pre-wrap break-all">
              {error}
            </div>
          )}

          {entries && entries.length > 0 && (
            <div className="space-y-1 pt-1">
              {entries.map((e) => (
                <div
                  key={e.path}
                  className="group flex items-center gap-2 rounded-lg border border-edge bg-ink/[0.03] px-2.5 py-1.5"
                >
                  <span className="flex items-center gap-1.5 font-mono text-[11px] text-ink shrink-0">
                    <BranchIcon />
                    {e.branch ?? "(detached)"}
                  </span>
                  {e.is_main && (
                    <span className="px-1.5 rounded-full border border-edge text-[9px] uppercase tracking-[0.12em] text-faint">
                      main
                    </span>
                  )}
                  <span
                    className="truncate font-mono text-[10px] text-faint"
                    title={e.path}
                  >
                    {e.path}
                  </span>
                  <span className="ml-auto flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      className="h-6 px-2 rounded-md border border-edge text-[10px] text-muted hover:border-accent/40 hover:text-accent transition-colors"
                      onClick={() => openEntry(e.path)}
                    >
                      Open
                    </button>
                    {!e.is_main && (
                      <button
                        className="h-6 px-2 rounded-md border border-edge text-[10px] text-muted hover:border-red-400/50 hover:text-red-300 transition-colors"
                        onClick={() => void removeEntry(e.path)}
                        title="git worktree remove — refuses if the tree is dirty; the branch survives"
                      >
                        Remove
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 h-8 px-4 border-t border-edge text-[10px] text-faint">
          <span>↵ create</span>
          <span>worktrees live in {repoName ?? "repo"}-worktrees/ next to the repo</span>
          <span className="ml-auto">{kbd("⌘⇧N")}</span>
        </div>
      </div>
    </div>
  );
}

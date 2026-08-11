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
import { useT } from "../../i18n";
import { useEscapeClose } from "../../lib/useEscapeClose";
import { Overlay, OverlayHeader, OverlayFooter } from "../Overlay/Overlay";
import { BranchIcon } from "../icons";

const FIELD =
  "w-full rounded-lg border border-edge bg-ink/[0.04] px-2.5 py-1.5 font-mono text-[12px] text-ink placeholder:text-faint focus:outline-none focus:border-accent/50";

/**
 * Worktree flows (⌘⇧N): task name → sibling worktree + branch → agent tab
 * (claude-squad's task-isolation model). The same surface lists existing
 * worktrees to open, merge or remove; every destructive step is non-force
 * only — git refusing a dirty tree is the safety rail.
 */
export default function WorktreeModal() {
  const t = useT();
  const open = useUiStore((s) => s.worktreeModalOpen);
  const setOpen = useUiStore((s) => s.setWorktreeModalOpen);
  const fleetCommand = useSettingsStore((s) => s.fleetCommand);
  const [task, setTask] = useState("");
  const [runAgent, setRunAgent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
      setRepoError(t("No active shell directory yet."));
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
    setNotice(null);
    setBusy(false);
    setRunAgent(true);
    void refresh();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const close = () => {
    setOpen(false);
    sendTermCmd("focus");
  };

  useEscapeClose(open, close);

  if (!open) return null;

  const branch = sanitizeTask(task);
  const mainPath = entries?.find((e) => e.is_main)?.path ?? null;
  const repoName = mainPath ? basename(mainPath) : null;
  const cmd = fleetCommand.trim();
  const canCreate = Boolean(branch) && !busy && !repoError;

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

  /**
   * Shared shape of the per-entry actions: clear the banners, run the git
   * call, re-list either way. Errors are shown verbatim — they are git's.
   */
  const runOnEntry = async (op: () => Promise<string | void>) => {
    const cwd = mainPath ?? cwdOf();
    if (!cwd || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const msg = await op();
      if (typeof msg === "string") setNotice(msg);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const removeEntry = (path: string) =>
    runOnEntry(() =>
      invoke("git_worktree_remove", { cwd: mainPath ?? cwdOf(), path }),
    );

  /** Finish a task: merge → remove worktree → safe-delete branch. */
  const mergeEntry = (entry: WorktreeEntry) =>
    entry.branch
      ? runOnEntry(() =>
          invoke<string>("git_worktree_merge", {
            cwd: mainPath ?? cwdOf(),
            path: entry.path,
            branch: entry.branch,
          }),
        )
      : undefined;

  return (
    <Overlay width={560} onClose={close}>
      <OverlayHeader title={t("Worktrees")} note={repoName ?? undefined} />

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
              placeholder={t("Task name — e.g. fix-login, 重构侧栏")}
              spellCheck={false}
              className={FIELD}
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
                <span>{t("Nothing usable in that name yet.")}</span>
              ) : (
                <span>
                  {t(
                    "Creates a sibling worktree on a new branch — agents work in parallel without touching your checkout.",
                  )}
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
                  {t("run ")}
                  <span className="font-mono text-ink">{cmd}</span>
                  {t(" in it")}
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
                {busy ? t("Working…") : t("Create worktree")}
              </button>
            </div>
          </>
        )}

        {error && <Banner tone="error">{error}</Banner>}
        {notice && <Banner tone="ok">{notice}</Banner>}

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
                  <EntryButton
                    label={t("Open")}
                    onClick={() => {
                      usePtyStore.getState().addTab(e.path);
                      close();
                    }}
                  />
                  {!e.is_main && e.branch && (
                    <EntryButton
                      label={t("Merge")}
                      tone="ok"
                      title={t(
                        "Finish: merge into the main checkout, remove the worktree, delete the branch. Refuses if dirty; a conflicting merge is aborted automatically.",
                      )}
                      onClick={() => void mergeEntry(e)}
                    />
                  )}
                  {!e.is_main && (
                    <EntryButton
                      label={t("Remove")}
                      tone="danger"
                      title={t(
                        "git worktree remove — refuses if the tree is dirty; the branch survives",
                      )}
                      onClick={() => void removeEntry(e.path)}
                    />
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <OverlayFooter>
        <span>↵ create</span>
        <span>
          worktrees live in {repoName ?? "repo"}-worktrees/ next to the repo
        </span>
        <span className="ml-auto">{kbd("⌘⇧N")}</span>
      </OverlayFooter>
    </Overlay>
  );
}

/** git's own output, shown verbatim — success in green, failure in red. */
function Banner({
  tone,
  children,
}: {
  tone: "error" | "ok";
  children: React.ReactNode;
}) {
  return (
    <div
      className={`px-3 py-2 rounded-lg border font-mono text-[10px] leading-relaxed whitespace-pre-wrap break-all ${
        tone === "error"
          ? "border-red-400/40 bg-red-500/10 text-red-300"
          : "border-emerald-400/40 bg-emerald-500/10 text-emerald-300"
      }`}
    >
      {children}
    </div>
  );
}

function EntryButton({
  label,
  title,
  tone,
  onClick,
}: {
  label: string;
  title?: string;
  tone?: "ok" | "danger";
  onClick: () => void;
}) {
  const hover =
    tone === "ok"
      ? "hover:border-emerald-400/50 hover:text-emerald-300"
      : tone === "danger"
        ? "hover:border-red-400/50 hover:text-red-300"
        : "hover:border-accent/40 hover:text-accent";
  return (
    <button
      className={`h-6 px-2 rounded-md border border-edge text-[10px] text-muted transition-colors ${hover}`}
      onClick={onClick}
      title={title}
    >
      {label}
    </button>
  );
}

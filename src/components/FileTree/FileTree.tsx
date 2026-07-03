import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useActivePane } from "../../stores/ptyStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { shellEscapePath } from "../../lib/shellEscape";
import { homeDir, tildify, joinPath, parentOf } from "../../lib/paths";
import { attachReviewPaths } from "../../lib/reviewAttachments";

interface FsEntry {
  name: string;
  is_dir: boolean;
}

function FolderIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
      className="shrink-0 text-accent/80"
    >
      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.9l1.4 1.7h4.7A1.5 1.5 0 0 1 14 6.2v5.3a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7Z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
      className="shrink-0 text-faint"
    >
      <path d="M4 2.5h5L12.5 6v7a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-9.5a1 1 0 0 1 .5-1Z" />
      <path d="M9 2.5V6h3.5" />
    </svg>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1.8 8s2.2-4 6.2-4 6.2 4 6.2 4-2.2 4-6.2 4S1.8 8 1.8 8Z" />
      <circle cx="8" cy="8" r="1.7" />
      {off && <path d="M2.5 13.5 13.5 2.5" />}
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M13.5 1.8v2.7h-2.7" />
    </svg>
  );
}

export default function FileTree() {
  const [cwd, setCwd] = useState<string>("");
  const [home, setHome] = useState<string | null>(null);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const showHidden = useSettingsStore((s) => s.showHiddenFiles);
  const toggleHidden = useSettingsStore((s) => s.toggleHiddenFiles);
  const activePane = useActivePane();
  const activePaneId = activePane?.id ?? null;
  const activeSessionId = activePane?.sessionId ?? null;
  const ptyCwd = activePane?.cwd ?? null;

  useEffect(() => {
    (async () => {
      const h = await homeDir();
      setHome(h);
      setCwd((prev) => prev || h);
    })();
  }, []);

  useEffect(() => {
    if (ptyCwd) setCwd(ptyCwd);
    // activePaneId is a deliberate dependency: re-sync to the newly focused
    // pane's cwd even when it happens to equal the previous pane's cwd value,
    // so manual FileTree browsing in one pane doesn't leak into another.
  }, [ptyCwd, activePaneId]);

  useEffect(() => {
    if (!cwd) return;
    setError(null);
    invoke<FsEntry[]>("fs_list_dir", { path: cwd, showHidden })
      .then(setEntries)
      .catch((err) => {
        setError(String(err));
        setEntries([]);
      });
  }, [cwd, showHidden, refreshTick]);

  const insertPath = useCallback(
    async (path: string) => {
      if (!activeSessionId) return;
      const escaped = await shellEscapePath(path);
      invoke("pty_write", {
        sessionId: activeSessionId,
        data: escaped + " ",
      });
    },
    [activeSessionId],
  );

  const atRoot = !cwd || parentOf(cwd) === cwd;

  return (
    <div className="text-sm flex flex-col h-full">
      <div className="px-3 pt-3 pb-2 border-b border-edge shrink-0">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-[0.18em] text-accent font-semibold">
            Files
          </div>
          <div className="flex items-center gap-0.5 -mr-1">
            <button
              className={`w-6 h-6 grid place-items-center rounded-md transition-colors ${
                showHidden
                  ? "text-accent hover:bg-accent/10"
                  : "text-faint hover:text-muted hover:bg-ink/5"
              }`}
              onClick={toggleHidden}
              title={showHidden ? "Hide dotfiles" : "Show dotfiles"}
            >
              <EyeIcon off={!showHidden} />
            </button>
            <button
              className="w-6 h-6 grid place-items-center rounded-md text-faint hover:text-muted hover:bg-ink/5 transition-colors"
              onClick={() => setRefreshTick((n) => n + 1)}
              title="Refresh"
            >
              <RefreshIcon />
            </button>
          </div>
        </div>
        <div
          className="font-mono text-[11px] text-muted mt-1 truncate cursor-pointer hover:text-accent transition-colors"
          title={cwd ? `${cwd} — click to insert` : undefined}
          onClick={() => insertPath(cwd)}
        >
          {cwd ? tildify(cwd, home) : "…"}
        </div>
      </div>
      <ul className="flex-1 overflow-y-auto py-1.5">
        {!atRoot && (
          <li
            className="mx-1.5 px-2 h-[26px] rounded-md flex items-center gap-2 cursor-pointer font-mono text-xs text-faint hover:bg-accent/[0.07] hover:text-muted transition-colors duration-100"
            onClick={() => setCwd(parentOf(cwd))}
          >
            ../
          </li>
        )}
        {error && (
          <li className="mx-1.5 px-2 py-2 text-red-400/90 text-xs break-all">
            {error}
          </li>
        )}
        {entries.map((e, i) => {
          const full = joinPath(cwd, e.name);
          const hidden = e.name.startsWith(".");
          return (
            <li
              key={full}
              style={{ animationDelay: `${Math.min(i * 12, 200)}ms` }}
              className="group mx-1.5 px-2 h-[26px] rounded-md flex items-center gap-2 cursor-pointer text-[12.5px] hover:bg-accent/[0.07] transition-colors duration-100 animate-[card-in_0.18s_ease-out_both]"
              onClick={() => {
                if (e.is_dir) setCwd(full);
                else insertPath(full);
              }}
              title={e.is_dir ? `${e.name} — open` : `${e.name} — insert path`}
              >
                {e.is_dir ? <FolderIcon /> : <FileIcon />}
                <span
                  className={`min-w-0 flex-1 truncate ${
                  e.is_dir
                    ? hidden
                      ? "text-ink/60"
                      : "text-ink"
                    : hidden
                      ? "text-ink/45"
                      : "text-ink/75"
                }`}
              >
                {e.name}
              </span>
              <button
                className="h-5 w-5 shrink-0 rounded text-faint opacity-0 transition-colors hover:bg-ink/10 hover:text-accent group-hover:opacity-100"
                title="Attach to review"
                onClick={(event) => {
                  event.stopPropagation();
                  attachReviewPaths([full]).catch((err) =>
                    console.error("attachReviewPaths failed", err),
                  );
                }}
              >
                +
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

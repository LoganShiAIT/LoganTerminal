import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useActivePane, usePtyStore } from "../../stores/ptyStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore } from "../../stores/uiStore";
import { shellEscapePath } from "../../lib/shellEscape";
import { homeDir, tildify, joinPath, parentOf } from "../../lib/paths";
import { attachReviewPaths } from "../../lib/reviewAttachments";
import { sendTermCmd } from "../../lib/termBus";
import { revealTarget } from "../../lib/reveal";
import { kbd } from "../../lib/keys";
import { useT } from "../../i18n";
import {
  EyeIcon,
  FileIcon,
  FolderIcon,
  RefreshIcon,
  SearchIcon,
  SplitIcon,
  TerminalPlusIcon,
} from "../icons";

interface FsEntry {
  name: string;
  is_dir: boolean;
}

export default function FileTree() {
  const t = useT();
  const [cwd, setCwd] = useState<string>("");
  const [home, setHome] = useState<string | null>(null);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [highlight, setHighlight] = useState<string | null>(null);
  const showHidden = useSettingsStore((s) => s.showHiddenFiles);
  const toggleHidden = useSettingsStore((s) => s.toggleHiddenFiles);
  const setFileSearchOpen = useUiStore((s) => s.setFileSearchOpen);
  const reveal = useUiStore((s) => s.reveal);
  const revealSeq = reveal?.seq ?? 0;
  const highlightRowRef = useRef<HTMLLIElement | null>(null);
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

  // Reveal request from the finder (⌘⇧F): jump to the entry's folder and
  // flash its row. Keyed on the counter, not the path, so revealing the same
  // entry twice in a row replays the highlight.
  useEffect(() => {
    const request = useUiStore.getState().reveal;
    if (!request) return;
    const { dir, highlight: name } = revealTarget(request.path, request.isDir);
    setCwd(dir);
    setHighlight(name);
    if (!name) return;
    const timer = window.setTimeout(() => setHighlight(null), 2400);
    return () => window.clearTimeout(timer);
  }, [revealSeq]);

  useEffect(() => {
    if (highlight) {
      highlightRowRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [highlight, entries]);

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

  /** Open a terminal rooted at a folder the tree is showing. */
  const openTabAt = useCallback((path: string) => {
    usePtyStore.getState().addTab(path);
    requestAnimationFrame(() => sendTermCmd("focus"));
  }, []);

  const splitAt = useCallback((path: string) => {
    usePtyStore.getState().splitPane("row", path);
    requestAnimationFrame(() => sendTermCmd("focus"));
  }, []);

  const atRoot = !cwd || parentOf(cwd) === cwd;

  return (
    <div className="text-[18px] flex flex-col h-full">
      <div className="px-3 pt-3 pb-2 border-b border-edge shrink-0">
        <div className="flex items-center justify-between">
          <div className="text-[14px] uppercase tracking-[0.18em] text-accent font-semibold">
            {t("Files")}
          </div>
          <div className="flex items-center gap-0.5 -mr-1">
            <button
              className="w-6 h-6 grid place-items-center rounded-md text-faint hover:text-accent hover:bg-accent/10 transition-colors disabled:opacity-40"
              disabled={!cwd}
              onClick={() => cwd && openTabAt(cwd)}
              title={t("New terminal here — {path}", { path: tildify(cwd, home) })}
            >
              <TerminalPlusIcon />
            </button>
            <button
              className="w-6 h-6 grid place-items-center rounded-md text-faint hover:text-accent hover:bg-accent/10 transition-colors"
              onClick={() => setFileSearchOpen(true)}
              title={t("Find file or folder ({key})", { key: kbd("⌘⇧F") })}
            >
              <SearchIcon />
            </button>
            <button
              className={`w-6 h-6 grid place-items-center rounded-md transition-colors ${
                showHidden
                  ? "text-accent hover:bg-accent/10"
                  : "text-faint hover:text-muted hover:bg-ink/5"
              }`}
              onClick={toggleHidden}
              title={showHidden ? t("Hide dotfiles") : t("Show dotfiles")}
            >
              <EyeIcon off={!showHidden} />
            </button>
            <button
              className="w-6 h-6 grid place-items-center rounded-md text-faint hover:text-muted hover:bg-ink/5 transition-colors"
              onClick={() => setRefreshTick((n) => n + 1)}
              title={t("Refresh")}
            >
              <RefreshIcon />
            </button>
          </div>
        </div>
        <div
          className="font-mono text-[15px] text-muted mt-1 truncate cursor-pointer hover:text-accent transition-colors"
          title={cwd ? t("{path} — click to insert", { path: cwd }) : undefined}
          onClick={() => insertPath(cwd)}
        >
          {cwd ? tildify(cwd, home) : "…"}
        </div>
      </div>
      <ul className="flex-1 overflow-y-auto py-1.5">
        {!atRoot && (
          <li
            className="mx-1.5 px-2 h-[26px] rounded-md flex items-center gap-2 cursor-pointer font-mono text-[16px] text-faint hover:bg-accent/[0.07] hover:text-muted transition-colors duration-100"
            onClick={() => setCwd(parentOf(cwd))}
          >
            ../
          </li>
        )}
        {error && (
          <li className="mx-1.5 px-2 py-2 text-red-400/90 text-[16px] break-all">
            {error}
          </li>
        )}
        {entries.map((e, i) => {
          const full = joinPath(cwd, e.name);
          const hidden = e.name.startsWith(".");
          const revealed = highlight === e.name;
          return (
            <li
              key={full}
              ref={revealed ? highlightRowRef : undefined}
              style={{ animationDelay: `${Math.min(i * 12, 200)}ms` }}
              className={`group mx-1.5 px-2 h-[26px] rounded-md flex items-center gap-2 cursor-pointer text-[12.5px] hover:bg-accent/[0.07] transition-colors duration-100 animate-[card-in_0.18s_ease-out_both] ${
                revealed ? "bg-accent/15 ring-1 ring-accent/50" : ""
              }`}
              onClick={() => {
                if (e.is_dir) setCwd(full);
                else insertPath(full);
              }}
              title={
                e.is_dir
                  ? t("{name} — open", { name: e.name })
                  : t("{name} — insert path", { name: e.name })
              }
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
              {e.is_dir && (
                <>
                  <button
                    className="grid h-5 w-5 shrink-0 place-items-center rounded text-faint opacity-0 transition-colors hover:bg-ink/10 hover:text-accent group-hover:opacity-100"
                    title={t("New terminal in {name}", { name: e.name })}
                    onClick={(event) => {
                      event.stopPropagation();
                      openTabAt(full);
                    }}
                  >
                    <TerminalPlusIcon />
                  </button>
                  <button
                    className="grid h-5 w-5 shrink-0 place-items-center rounded text-faint opacity-0 transition-colors hover:bg-ink/10 hover:text-accent group-hover:opacity-100"
                    title={t("Split the focused pane, starting in {name}", { name: e.name })}
                    onClick={(event) => {
                      event.stopPropagation();
                      splitAt(full);
                    }}
                  >
                    <SplitIcon />
                  </button>
                </>
              )}
              <button
                className="h-5 w-5 shrink-0 rounded text-faint opacity-0 transition-colors hover:bg-ink/10 hover:text-accent group-hover:opacity-100"
                title={t("Attach to review")}
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

import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useActiveTab } from "../../stores/ptyStore";
import { shellEscapePath } from "../../lib/shellEscape";

interface FsEntry {
  name: string;
  is_dir: boolean;
}

function joinPath(base: string, name: string): string {
  if (base.endsWith("/")) return base + name;
  return base + "/" + name;
}

function parentOf(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  if (idx <= 0) return "/";
  return trimmed.slice(0, idx);
}

export default function FileTree() {
  const [cwd, setCwd] = useState<string>("");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const activeTab = useActiveTab();
  const activeTabId = activeTab?.id ?? null;
  const activeSessionId = activeTab?.sessionId ?? null;
  const ptyCwd = activeTab?.cwd ?? null;

  useEffect(() => {
    (async () => {
      const home = await invoke<string>("fs_home_dir");
      setCwd((prev) => prev || home);
    })();
  }, []);

  useEffect(() => {
    if (ptyCwd) setCwd(ptyCwd);
    // activeTabId is a deliberate dependency: re-sync to the newly active
    // tab's cwd even when it happens to equal the previous tab's cwd value,
    // so manual FileTree browsing in one tab doesn't leak into another.
  }, [ptyCwd, activeTabId]);

  useEffect(() => {
    if (!cwd) return;
    setError(null);
    invoke<FsEntry[]>("fs_list_dir", { path: cwd })
      .then(setEntries)
      .catch((err) => {
        setError(String(err));
        setEntries([]);
      });
  }, [cwd]);

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

  return (
    <div className="text-sm flex flex-col h-full">
      <div className="p-3 pb-2 border-b border-[color:var(--border-warm)] shrink-0">
        <div className="text-[10px] uppercase tracking-[0.15em] text-[color:var(--claude-orange)] font-semibold">
          Files
        </div>
        <div
          className="text-[color:var(--text-muted)] text-xs mt-1 truncate cursor-pointer hover:text-[color:var(--claude-orange)] transition-colors"
          title={cwd}
          onClick={() => insertPath(cwd)}
        >
          {cwd || "…"}
        </div>
      </div>
      <ul className="flex-1 overflow-y-auto py-1">
        {cwd && cwd !== "/" && (
          <li
            className="px-3 py-0.5 hover:bg-[color:var(--claude-orange-soft)] cursor-pointer text-[color:var(--text-muted)]"
            onClick={() => setCwd(parentOf(cwd))}
          >
            ../
          </li>
        )}
        {error && (
          <li className="px-3 py-2 text-red-400 text-xs">{error}</li>
        )}
        {entries.map((e) => {
          const full = joinPath(cwd, e.name);
          return (
            <li
              key={e.name}
              className="px-3 py-0.5 hover:bg-[color:var(--claude-orange-soft)] cursor-pointer flex items-center gap-2 transition-colors"
              onClick={() => {
                if (e.is_dir) setCwd(full);
                else insertPath(full);
              }}
              title={e.name}
            >
              <span
                className={
                  e.is_dir
                    ? "text-[color:var(--claude-orange)] truncate"
                    : "text-[color:var(--text-primary)] truncate"
                }
              >
                {e.name}
                {e.is_dir && "/"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

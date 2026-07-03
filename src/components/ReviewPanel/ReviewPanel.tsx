import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  useReviewStore,
  type ReviewAttachment,
  type ReviewKind,
} from "../../stores/reviewStore";
import { useActivePane } from "../../stores/ptyStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { basename, joinPath } from "../../lib/paths";
import { shellEscapePath } from "../../lib/shellEscape";

const MAX_DIRECT_READ_BYTES = 1024 * 1024;

interface FsEntry {
  name: string;
  is_dir: boolean;
}

interface FsPathInfo {
  path: string;
  name: string;
  kind: "file" | "directory" | "other";
  size: number;
}

type LoadState = "idle" | "loading" | "ready" | "blocked" | "error";

export default function ReviewPanel() {
  const attachments = useReviewStore((s) => s.attachments);
  const selectedPath = useReviewStore((s) => s.selectedPath);
  const selectPath = useReviewStore((s) => s.selectPath);
  const activeSessionId = useActivePane()?.sessionId ?? null;

  const [info, setInfo] = useState<FsPathInfo | null>(null);
  const [content, setContent] = useState("");
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<LoadState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const dirty = draft !== content;

  useEffect(() => {
    if (!selectedPath) {
      setInfo(null);
      setContent("");
      setDraft("");
      setState("idle");
      setMessage(null);
      return;
    }

    let cancelled = false;
    setState("loading");
    setMessage(null);
    setContent("");
    setDraft("");

    (async () => {
      try {
        const nextInfo = await invoke<FsPathInfo>("fs_stat_path", {
          path: selectedPath,
        });
        if (cancelled) return;
        setInfo(nextInfo);

        if (nextInfo.kind !== "file") {
          setState("blocked");
          setMessage(
            nextInfo.kind === "directory"
              ? "Select a text file inside this folder to review it."
              : "This path cannot be reviewed as text.",
          );
          return;
        }

        if (nextInfo.size > MAX_DIRECT_READ_BYTES) {
          setState("blocked");
          setMessage("This file is larger than 1MB, so it was not loaded.");
          return;
        }

        const text = await invoke<string>("fs_read_text_file", {
          path: selectedPath,
        });
        if (cancelled) return;
        setContent(text);
        setDraft(text);
        setState("ready");
      } catch (err) {
        if (cancelled) return;
        setInfo(null);
        setState("error");
        setMessage(String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedPath]);

  const selectedName = info?.name ?? (selectedPath ? basename(selectedPath) : "");

  const insertPath = async () => {
    if (!activeSessionId || !selectedPath) return;
    const escaped = await shellEscapePath(selectedPath);
    invoke("pty_write", { sessionId: activeSessionId, data: escaped + " " });
  };

  const save = async () => {
    if (!selectedPath || state !== "ready") return;
    setMessage(null);
    try {
      await invoke("fs_write_text_file", { path: selectedPath, contents: draft });
      setContent(draft);
      setMessage("Saved.");
    } catch (err) {
      setMessage(String(err));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="px-3 pt-3 pb-2 border-b border-edge shrink-0">
        <div className="text-[10px] uppercase tracking-[0.18em] text-accent font-semibold">
          File Review
        </div>
        <div className="font-mono text-[11px] text-muted mt-1 truncate">
          {attachments.length === 0
            ? "drop files or folders to attach"
            : `${attachments.length} attached`}
        </div>
      </div>

      <div className="min-h-0 flex-1 grid grid-rows-[minmax(120px,38%)_1fr]">
        <div className="min-h-0 border-b border-edge overflow-y-auto p-2">
          {attachments.length === 0 ? (
            <Placeholder />
          ) : (
            <div className="space-y-1.5">
              {attachments.map((item) => (
                <AttachmentNode
                  key={item.id}
                  item={item}
                  selectedPath={selectedPath}
                  onSelect={selectPath}
                />
              ))}
            </div>
          )}
        </div>

        <div className="min-h-0 flex flex-col">
          <div className="border-b border-edge p-2 shrink-0">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-ink">
                  {selectedName || "No file selected"}
                </div>
                <div className="truncate font-mono text-[10px] text-faint">
                  {selectedPath ?? "Attach or select a path to review"}
                </div>
              </div>
              {dirty && (
                <span className="shrink-0 rounded-full border border-accent/40 px-2 py-0.5 text-[10px] text-accent">
                  unsaved
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <PanelButton disabled={!selectedPath} onClick={() => selectedPath && openPath(selectedPath)}>
                Open
              </PanelButton>
              <PanelButton disabled={!selectedPath || !activeSessionId} onClick={insertPath}>
                Insert Path
              </PanelButton>
              <PanelButton
                disabled={!selectedPath}
                onClick={() => selectedPath && navigator.clipboard.writeText(selectedPath)}
              >
                Copy Path
              </PanelButton>
              <PanelButton disabled={!dirty || state !== "ready"} onClick={save}>
                Save
              </PanelButton>
            </div>
          </div>

          {state === "ready" ? (
            <textarea
              className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-[12px] leading-relaxed text-ink outline-none"
              spellCheck={false}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center p-5 text-center text-xs leading-relaxed text-muted">
              {state === "loading"
                ? "Loading..."
                : message || "Select a text file to review."}
            </div>
          )}

          {message && state === "ready" && (
            <div className="border-t border-edge px-3 py-1.5 text-[11px] text-muted">
              {message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AttachmentNode({
  item,
  selectedPath,
  onSelect,
}: {
  item: ReviewAttachment;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const removeAttachment = useReviewStore((s) => s.removeAttachment);
  const toggleExpanded = useReviewStore((s) => s.toggleExpanded);
  const active = selectedPath === item.path;

  return (
    <div>
      <PathRow
        active={active}
        kind={item.kind}
        name={item.name}
        depth={0}
        expanded={item.kind === "directory" ? item.expanded : undefined}
        onSelect={() => onSelect(item.path)}
        onToggle={
          item.kind === "directory" ? () => toggleExpanded(item.id) : undefined
        }
        rightSlot={
          <button
            className="h-5 w-5 rounded text-faint opacity-0 transition-colors hover:bg-ink/10 hover:text-ink group-hover:opacity-100"
            title="Remove attachment"
            onClick={(e) => {
              e.stopPropagation();
              removeAttachment(item.id);
            }}
          >
            x
          </button>
        }
      />
      {item.kind === "directory" && item.expanded && (
        <DirectoryChildren
          path={item.path}
          depth={1}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      )}
    </div>
  );
}

function DirectoryChildren({
  path,
  depth,
  selectedPath,
  onSelect,
}: {
  path: string;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const showHidden = useSettingsStore((s) => s.showHiddenFiles);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    invoke<FsEntry[]>("fs_list_dir", { path, showHidden })
      .then((next) => {
        if (!cancelled) setEntries(next);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err));
          setEntries([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, showHidden]);

  const childRows = useMemo(
    () =>
      entries.map((entry) => {
        const full = joinPath(path, entry.name);
        const kind: ReviewKind = entry.is_dir ? "directory" : "file";
        const isExpanded = expanded.has(full);
        return (
          <div key={full}>
            <PathRow
              active={selectedPath === full}
              kind={kind}
              name={entry.name}
              depth={depth}
              expanded={entry.is_dir ? isExpanded : undefined}
              onSelect={() => onSelect(full)}
              onToggle={
                entry.is_dir
                  ? () =>
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(full)) next.delete(full);
                        else next.add(full);
                        return next;
                      })
                  : undefined
              }
            />
            {entry.is_dir && isExpanded && (
              <DirectoryChildren
                path={full}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
              />
            )}
          </div>
        );
      }),
    [depth, entries, expanded, onSelect, path, selectedPath],
  );

  if (loading) {
    return <div className="px-2 py-1 text-[11px] text-faint">Loading...</div>;
  }
  if (error) {
    return <div className="px-2 py-1 text-[11px] text-red-400">{error}</div>;
  }
  return <div>{childRows}</div>;
}

function PathRow({
  active,
  kind,
  name,
  depth,
  expanded,
  onSelect,
  onToggle,
  rightSlot,
}: {
  active: boolean;
  kind: ReviewKind;
  name: string;
  depth: number;
  expanded?: boolean;
  onSelect: () => void;
  onToggle?: () => void;
  rightSlot?: React.ReactNode;
}) {
  return (
    <div
      className={`group flex h-7 cursor-pointer items-center gap-1.5 rounded-md pr-1 text-[12px] transition-colors ${
        active
          ? "bg-accent/15 text-accent"
          : "text-ink/80 hover:bg-accent/[0.07] hover:text-ink"
      }`}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={onSelect}
      title={name}
    >
      <button
        className="grid h-5 w-5 shrink-0 place-items-center rounded text-faint hover:bg-ink/10 hover:text-ink disabled:opacity-30"
        disabled={!onToggle}
        onClick={(e) => {
          e.stopPropagation();
          onToggle?.();
        }}
      >
        {kind === "directory" ? (expanded ? "v" : ">") : ""}
      </button>
      <span className="shrink-0 text-[11px] text-faint">
        {kind === "directory" ? "dir" : "txt"}
      </span>
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {rightSlot}
    </div>
  );
}

function PanelButton({
  disabled,
  onClick,
  children,
}: {
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className="h-7 rounded-md border border-edge px-2 text-[11px] text-muted transition-colors hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Placeholder() {
  return (
    <div className="rounded-lg border border-dashed border-edge px-3 py-5 text-center text-[11px] leading-relaxed text-faint">
      Drop files or folders here to review them.
    </div>
  );
}

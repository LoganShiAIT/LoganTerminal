import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getActiveLeaf } from "../../stores/ptyStore";
import { useUiStore } from "../../stores/uiStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { shellEscapePath } from "../../lib/shellEscape";
import { homeDir, tildify, parentOf } from "../../lib/paths";
import { attachReviewPaths } from "../../lib/reviewAttachments";
import { sendTermCmd } from "../../lib/termBus";
import { kbd } from "../../lib/keys";
import { useT } from "../../i18n";

export interface SearchHit {
  path: string;
  rel: string;
  name: string;
  is_dir: boolean;
  is_repo: boolean;
  score: number;
  /** Char (not UTF-16 unit) indices into `rel`. */
  indices: number[];
}

interface SearchOutcome {
  hits: SearchHit[];
  scanned: number;
  total: number;
  truncated: boolean;
}

type Kind = "all" | "dir" | "file";

const DEBOUNCE_MS = 110;
const LIMIT = 120;

const KINDS: Array<{ id: Kind; labelKey: string }> = [
  { id: "all", labelKey: "All" },
  { id: "dir", labelKey: "Folders" },
  { id: "file", labelKey: "Files" },
];

export default function FileSearch() {
  const t = useT();
  const open = useUiStore((s) => s.fileSearchOpen);
  const setOpen = useUiStore((s) => s.setFileSearchOpen);
  const revealInFileTree = useUiStore((s) => s.revealInFileTree);
  const showHidden = useSettingsStore((s) => s.showHiddenFiles);

  const [root, setRoot] = useState<string>("");
  const [home, setHome] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    homeDir()
      .then(setHome)
      .catch(() => {});
  }, []);

  // Each open starts a fresh search rooted at whatever the focused pane is
  // looking at — that is nearly always the project the user means.
  useEffect(() => {
    if (!open) return;
    const leaf = getActiveLeaf();
    const cwd = leaf?.cwd ?? leaf?.initialCwd ?? null;
    setRoot(cwd || home || "");
    setQuery("");
    setSelected(0);
    setError(null);
    requestAnimationFrame(() => inputRef.current?.focus());

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Capture phase: the focused xterm textarea would otherwise eat it.
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        sendTermCmd("focus");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, home, setOpen]);

  // Debounced, stateless re-walk per query. The seq guard drops responses
  // that come back after a newer request was already fired.
  useEffect(() => {
    if (!open || !root) return;
    const seq = ++seqRef.current;
    setBusy(true);
    const timer = window.setTimeout(() => {
      invoke<SearchOutcome>("fs_search", {
        root,
        query,
        kind,
        showHidden,
        limit: LIMIT,
      })
        .then((res) => {
          if (seq !== seqRef.current) return;
          setOutcome(res);
          setError(null);
          setSelected(0);
          setBusy(false);
        })
        .catch((err) => {
          if (seq !== seqRef.current) return;
          setOutcome(null);
          setError(String(err));
          setBusy(false);
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [open, root, query, kind, showHidden]);

  const hits = useMemo(() => outcome?.hits ?? [], [outcome]);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected, hits.length]);

  const close = useCallback(
    (refocusTerminal: boolean) => {
      setOpen(false);
      if (refocusTerminal) sendTermCmd("focus");
    },
    [setOpen],
  );

  const reveal = useCallback(
    (hit: SearchHit) => {
      revealInFileTree(hit.path, hit.is_dir);
      close(true);
    },
    [revealInFileTree, close],
  );

  const insert = useCallback(
    async (hit: SearchHit) => {
      close(true);
      const sid = getActiveLeaf()?.sessionId;
      if (!sid) return;
      const escaped = await shellEscapePath(hit.path);
      invoke("pty_write", { sessionId: sid, data: escaped + " " });
    },
    [close],
  );

  const cdTo = useCallback(
    async (hit: SearchHit) => {
      close(true);
      const sid = getActiveLeaf()?.sessionId;
      if (!sid) return;
      const target = hit.is_dir ? hit.path : parentOf(hit.path);
      const escaped = await shellEscapePath(target);
      invoke("pty_write", { sessionId: sid, data: `cd ${escaped}\r` });
    },
    [close],
  );

  const attach = useCallback(
    (hit: SearchHit) => {
      close(false);
      attachReviewPaths([hit.path]).catch((err) =>
        console.error("attachReviewPaths failed", err),
      );
    },
    [close],
  );

  if (!open) return null;

  const atRoot = !root || parentOf(root) === root;
  const rootLabel = root ? tildify(root, home) : "…";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[11vh] bg-black/35 backdrop-blur-[2px] animate-[fade-in_0.1s_ease-out]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close(true);
      }}
    >
      <div className="w-[640px] max-w-[92vw] overflow-hidden rounded-2xl border border-edge bg-raise/95 backdrop-blur-xl shadow-[0_24px_80px_rgba(0,0,0,0.55)] animate-[pop-in_0.14s_ease-out]">
        <div className="flex h-12 items-center gap-2.5 border-b border-edge px-4">
          <SearchIcon />
          <input
            ref={inputRef}
            type="text"
            spellCheck={false}
            placeholder={t("Find a file or folder — fuzzy, matches the whole path")}
            className="flex-1 bg-transparent font-mono text-[13px] text-ink placeholder:text-faint focus:outline-none"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              const count = Math.max(hits.length, 1);
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelected((s) => (s + 1) % count);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelected((s) => (s - 1 + count) % count);
              } else if (e.key === "Enter") {
                e.preventDefault();
                const hit = hits[selected];
                if (!hit) return;
                if (e.metaKey || e.ctrlKey) insert(hit);
                else if (e.altKey) cdTo(hit);
                else if (e.shiftKey) attach(hit);
                else reveal(hit);
              }
            }}
          />
          {busy && (
            <span
              className="h-3 w-3 shrink-0 animate-spin rounded-full border border-accent/30 border-t-accent"
              aria-label={t("Searching")}
            />
          )}
          <span className="kbd shrink-0">esc</span>
        </div>

        <div className="flex items-center gap-2 border-b border-edge px-4 py-2">
          <span className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-faint shrink-0">
            {t("in")}
          </span>
          <span
            className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted"
            title={root}
          >
            {rootLabel}
          </span>
          <button
            className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] text-faint transition-colors hover:bg-ink/5 hover:text-accent disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-faint"
            disabled={atRoot}
            onClick={() => setRoot(parentOf(root))}
            title={t("Search from the parent folder")}
          >
            {t("↑ parent")}
          </button>
          <button
            className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] text-faint transition-colors hover:bg-ink/5 hover:text-accent"
            onClick={() => home && setRoot(home)}
            title={t("Search from your home folder")}
          >
            {t("⌂ home")}
          </button>
          <span className="mx-0.5 h-3.5 w-px shrink-0 bg-edge" />
          {KINDS.map((k) => (
            <button
              key={k.id}
              className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] transition-colors ${
                kind === k.id
                  ? "bg-accent/15 text-accent"
                  : "text-faint hover:bg-ink/5 hover:text-muted"
              }`}
              onClick={() => setKind(k.id)}
            >
              {t(k.labelKey)}
            </button>
          ))}
        </div>

        <div className="max-h-[46vh] overflow-y-auto py-1.5">
          {error && (
            <div className="break-all px-4 py-6 text-center text-xs text-red-400/90">
              {error}
            </div>
          )}
          {!error && hits.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-faint">
              {busy ? t("Searching…") : t("Nothing matches")}
            </div>
          )}
          {hits.map((hit, i) => {
            const isSelected = i === selected;
            return (
              <div
                key={hit.path}
                ref={isSelected ? selectedRef : undefined}
                className={`group relative mx-1.5 flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors duration-75 ${
                  isSelected
                    ? "bg-accent/[0.13] text-ink"
                    : "text-ink/75 hover:bg-ink/[0.05]"
                }`}
                onMouseMove={() => setSelected(i)}
                onClick={() => reveal(hit)}
                title={hit.path}
              >
                {isSelected && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-full bg-accent" />
                )}
                {hit.is_dir ? <FolderIcon /> : <FileIcon />}
                <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">
                  <HighlightedPath hit={hit} />
                </span>
                {hit.is_repo && (
                  <span
                    className="shrink-0 rounded-full border border-accent/35 px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.12em] text-accent"
                    title={t("Git repository")}
                  >
                    {t("repo")}
                  </span>
                )}
                <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <RowButton
                    label="⌘↵"
                    title={t("Insert path into the terminal")}
                    onClick={() => insert(hit)}
                  />
                  <RowButton
                    label="cd"
                    title={
                      hit.is_dir
                        ? t("cd into this folder")
                        : t("cd into the containing folder")
                    }
                    onClick={() => cdTo(hit)}
                  />
                  <RowButton
                    label="+"
                    title={t("Attach to review")}
                    onClick={() => attach(hit)}
                  />
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex h-8 items-center gap-3 border-t border-edge px-4 text-[10px] text-faint">
          <span>
            <span className="text-muted">↩</span> {t("reveal")}
          </span>
          <span>
            <span className="text-muted">{kbd("⌘↩")}</span> {t("insert path")}
          </span>
          <span>
            <span className="text-muted">{kbd("⌥↩")}</span> {t("cd")}
          </span>
          <span>
            <span className="text-muted">⇧↩</span> {t("attach")}
          </span>
          <span className="ml-auto shrink-0 font-mono">
            {outcome
              ? `${hits.length}${outcome.total > hits.length ? `/${outcome.total}` : ""}${
                  outcome.truncated ? ` · ${t("partial scan")}` : ""
                }`
              : "…"}
          </span>
        </div>
      </div>
    </div>
  );
}

function RowButton({
  label,
  title,
  onClick,
}: {
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      className="grid h-5 min-w-[20px] place-items-center rounded px-1 font-mono text-[10px] text-faint transition-colors hover:bg-ink/10 hover:text-accent"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {label}
    </button>
  );
}

/**
 * Renders the relative path with matched chars accented, dimming the parent
 * directories so the entry's own name stays the thing you read first.
 * Indices come from Rust as *char* offsets — hence Array.from, which keeps
 * them aligned even for names with astral-plane characters.
 */
function HighlightedPath({ hit }: { hit: SearchHit }) {
  const chars = Array.from(hit.rel);
  const nameStart = chars.length - Array.from(hit.name).length;
  const matched = new Set(hit.indices);
  return (
    <>
      {chars.map((ch, i) => (
        <span
          key={i}
          className={
            matched.has(i)
              ? "font-semibold text-accent"
              : i < nameStart
                ? "text-faint"
                : ""
          }
        >
          {ch}
        </span>
      ))}
    </>
  );
}

function SearchIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      className="shrink-0 text-accent"
      aria-hidden
    >
      <circle cx="7" cy="7" r="4.3" />
      <path d="m10.3 10.3 3.2 3.2" />
    </svg>
  );
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
      aria-hidden
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
      aria-hidden
    >
      <path d="M4 2.5h5L12.5 6v7a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-9.5a1 1 0 0 1 .5-1Z" />
      <path d="M9 2.5V6h3.5" />
    </svg>
  );
}

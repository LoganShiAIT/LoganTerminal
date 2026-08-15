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
import { useEscapeClose } from "../../lib/useEscapeClose";
import { useListSelection } from "../../lib/useListSelection";
import {
  Overlay,
  OverlayHeader,
  OverlayList,
  OverlayRow,
  OverlayFooter,
  OverlayHint,
  OverlayEmpty,
} from "../Overlay/Overlay";
import { FileIcon, FolderIcon, SearchIcon } from "../icons";

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

/** ⌘⇧F: fuzzy-find a file or folder anywhere under the active project. */
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
  const inputRef = useRef<HTMLInputElement>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    homeDir()
      .then(setHome)
      .catch(() => {});
  }, []);

  const hits = useMemo(() => outcome?.hits ?? [], [outcome]);

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

  /** Write to the focused pane's shell, if there still is one. */
  const toShell = useCallback(
    async (data: (escaped: string) => string, target: string) => {
      close(true);
      const sid = getActiveLeaf()?.sessionId;
      if (!sid) return;
      invoke("pty_write", { sessionId: sid, data: data(await shellEscapePath(target)) });
    },
    [close],
  );

  const insert = useCallback(
    (hit: SearchHit) => toShell((p) => p + " ", hit.path),
    [toShell],
  );

  const cdTo = useCallback(
    (hit: SearchHit) =>
      toShell((p) => `cd ${p}\r`, hit.is_dir ? hit.path : parentOf(hit.path)),
    [toShell],
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

  const { selected, setSelected, selectedRef, handleKey } = useListSelection(
    hits.length,
    (i) => {
      const hit = hits[i];
      if (hit) reveal(hit);
    },
  );

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
  }, [open, home, setSelected]);

  useEscapeClose(open, () => close(true));

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
  }, [open, root, query, kind, showHidden, setSelected]);

  if (!open) return null;

  const atRoot = !root || parentOf(root) === root;

  return (
    <Overlay width={640} onClose={() => close(true)}>
      <OverlayHeader title="">
        <SearchIcon size={18} className="shrink-0 text-accent" />
        <input
          ref={inputRef}
          type="text"
          spellCheck={false}
          placeholder={t("Find a file or folder — fuzzy, matches the whole path")}
          className="flex-1 bg-transparent font-mono text-[17px] text-ink placeholder:text-faint focus:outline-none"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Enter's modifiers pick the action; the hook only owns plain ↩.
            if (e.key === "Enter") {
              const hit = hits[selected];
              if (!hit) return;
              e.preventDefault();
              if (e.metaKey || e.ctrlKey) insert(hit);
              else if (e.altKey) cdTo(hit);
              else if (e.shiftKey) attach(hit);
              else reveal(hit);
              return;
            }
            if (handleKey(e)) e.preventDefault();
          }}
        />
        {busy && (
          <span
            className="h-3 w-3 shrink-0 animate-spin rounded-full border border-accent/30 border-t-accent"
            aria-label={t("Searching")}
          />
        )}
        <span className="kbd shrink-0">esc</span>
      </OverlayHeader>

      <div className="flex items-center gap-2 border-b border-edge px-4 py-2">
        <span className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-faint shrink-0">
          {t("in")}
        </span>
        <span
          className="min-w-0 flex-1 truncate font-mono text-[15px] text-muted"
          title={root}
        >
          {root ? tildify(root, home) : "…"}
        </span>
        <ScopeButton
          label={t("↑ parent")}
          title={t("Search from the parent folder")}
          disabled={atRoot}
          onClick={() => setRoot(parentOf(root))}
        />
        <ScopeButton
          label={t("⌂ home")}
          title={t("Search from your home folder")}
          onClick={() => home && setRoot(home)}
        />
        <span className="mx-0.5 h-3.5 w-px shrink-0 bg-edge" />
        {KINDS.map((k) => (
          <button
            key={k.id}
            className={`shrink-0 rounded-md px-1.5 py-0.5 text-[14px] transition-colors ${
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

      <OverlayList>
        {error && <OverlayEmpty tone="error">{error}</OverlayEmpty>}
        {!error && hits.length === 0 && (
          <OverlayEmpty>
            {busy ? t("Searching…") : t("Nothing matches")}
          </OverlayEmpty>
        )}
        {hits.map((hit, i) => (
          <OverlayRow
            key={hit.path}
            selected={i === selected}
            rowRef={selectedRef}
            onSelect={() => setSelected(i)}
            onActivate={() => reveal(hit)}
            title={hit.path}
          >
            {hit.is_dir ? <FolderIcon /> : <FileIcon />}
            <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">
              <HighlightedPath hit={hit} />
            </span>
            {hit.is_repo && (
              <span
                className="shrink-0 rounded-full border border-accent/35 px-1.5 py-px text-[13px] font-semibold uppercase tracking-[0.12em] text-accent"
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
          </OverlayRow>
        ))}
      </OverlayList>

      <OverlayFooter>
        <OverlayHint keys="↩" label={t("reveal")} />
        <OverlayHint keys={kbd("⌘↩")} label={t("insert path")} />
        <OverlayHint keys={kbd("⌥↩")} label={t("cd")} />
        <OverlayHint keys="⇧↩" label={t("attach")} />
        <span className="ml-auto shrink-0 font-mono">
          {outcome
            ? `${hits.length}${outcome.total > hits.length ? `/${outcome.total}` : ""}${
                outcome.truncated ? ` · ${t("partial scan")}` : ""
              }`
            : "…"}
        </span>
      </OverlayFooter>
    </Overlay>
  );
}

/** "Search from here instead" control in the scope bar. */
function ScopeButton({
  label,
  title,
  disabled,
  onClick,
}: {
  label: string;
  title: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="shrink-0 rounded-md px-1.5 py-0.5 text-[14px] text-faint transition-colors hover:bg-ink/5 hover:text-accent disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-faint"
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      {label}
    </button>
  );
}

/** Per-row shortcut button; stops propagation so it doesn't also reveal. */
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
      className="grid h-5 min-w-[20px] place-items-center rounded px-1 font-mono text-[14px] text-faint transition-colors hover:bg-ink/10 hover:text-accent"
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

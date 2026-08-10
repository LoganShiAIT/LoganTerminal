import { useCallback, useEffect, useMemo, useState } from "react";
import {
  allDirPaths,
  buildDiffTree,
  flattenTree,
  type TreeDirNode,
  type TreeFileNode,
} from "../../lib/diffTree";
import { classifyDiffLine, type DiffFile, type DiffLineKind } from "../../lib/git";
import { joinPath } from "../../lib/paths";
import { attachReviewPaths } from "../../lib/reviewAttachments";
import { useT } from "../../i18n";

const LINE_CLASS: Record<DiffLineKind, string> = {
  add: "text-emerald-300 bg-emerald-500/[0.07]",
  del: "text-red-300 bg-red-500/[0.07]",
  hunk: "text-accent/90 bg-accent/[0.06]",
  meta: "text-faint",
  ctx: "text-muted",
};

/** One indent step, in px — also the width of the guide line column. */
const INDENT = 13;

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
      aria-hidden
    >
      <path d="m6 3 5 5-5 5" />
    </svg>
  );
}

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2.5 8h11" />
      {collapsed ? (
        <path d="M5.5 4.5 8 2l2.5 2.5M5.5 11.5 8 14l2.5-2.5" />
      ) : (
        <path d="M5.5 3.5 8 6l2.5-2.5M5.5 12.5 8 10l2.5 2.5" />
      )}
    </svg>
  );
}

/** An arrow heading into the side panel: "send this file to the reviewer". */
function ToReviewIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9.8 2.8h2.7a1 1 0 0 1 1 1v8.4a1 1 0 0 1-1 1H9.8" />
      <path d="M2.5 8h6.2M6.4 5.6 8.8 8l-2.4 2.4" />
    </svg>
  );
}

function Patch({ text }: { text: string }) {
  const t = useT();
  if (!text.trim()) {
    return (
      <div className="px-3 py-2 text-[10px] text-faint">
        {t("No textual changes (empty or binary file).")}
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

function Stat({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <>
      {additions > 0 && <span className="text-emerald-300/90">+{additions}</span>}
      {deletions > 0 && <span className="text-red-300/90">−{deletions}</span>}
    </>
  );
}

function fileStat(f: DiffFile, t: ReturnType<typeof useT>) {
  if (f.untracked) {
    return <span className="text-[9px] uppercase text-emerald-300/90">{t("new")}</span>;
  }
  if (f.additions === null && f.deletions === null) {
    return <span className="text-[9px] uppercase text-faint">{t("bin")}</span>;
  }
  return <Stat additions={f.additions ?? 0} deletions={f.deletions ?? 0} />;
}

/** Indent guides — one thin rule per ancestor level. */
function Guides({ depth }: { depth: number }) {
  return (
    <>
      {Array.from({ length: depth }, (_, i) => (
        <span
          key={i}
          style={{ width: INDENT }}
          className="shrink-0 self-stretch border-l border-edge"
          aria-hidden
        />
      ))}
    </>
  );
}

export interface DiffFileTreeProps {
  files: DiffFile[];
  /** Worktree root the file paths are relative to — see `DiffSummary.root`. */
  root: string;
  /** Loads one file's unified patch. Must be referentially stable. */
  loadPatch: (file: DiffFile) => Promise<string>;
  /** Bump to refetch the open patch — the content behind it may have moved. */
  reloadKey?: string | number;
  /** Hides the "N files · +x −y" bar where the caller already shows totals. */
  compact?: boolean;
}

/**
 * The changed files of one diff, as a collapsible folder tree; clicking a file
 * expands its patch in place. Used for both the working/branch diffs and the
 * file list of a single commit, which is why the patch loader is injected.
 */
export default function DiffFileTree({
  files,
  root,
  loadPatch,
  reloadKey,
  compact = false,
}: DiffFileTreeProps) {
  const t = useT();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [patch, setPatch] = useState<string | null>(null);
  const [patchError, setPatchError] = useState<string | null>(null);

  const tree = useMemo(() => buildDiffTree(files), [files]);
  const rows = useMemo(() => flattenTree(tree, collapsed), [tree, collapsed]);
  const dirPaths = useMemo(() => allDirPaths(tree), [tree]);
  const allCollapsed = dirPaths.length > 0 && dirPaths.every((p) => collapsed.has(p));

  const totals = useMemo(
    () =>
      files.reduce(
        (acc, f) => ({
          additions: acc.additions + (f.additions ?? 0),
          deletions: acc.deletions + (f.deletions ?? 0),
        }),
        { additions: 0, deletions: 0 },
      ),
    [files],
  );

  const openFile = useMemo(
    () => (openPath ? (files.find((f) => f.path === openPath) ?? null) : null),
    [files, openPath],
  );
  // Committed or cleaned away since it was selected.
  useEffect(() => {
    if (openPath && !openFile) setOpenPath(null);
  }, [openPath, openFile]);

  const openKey = openFile ? `${openFile.untracked ? "u:" : ""}${openFile.path}` : null;
  useEffect(() => {
    if (!openFile) {
      setPatch(null);
      setPatchError(null);
      return;
    }
    let cancelled = false;
    loadPatch(openFile)
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
    // openKey stands in for openFile, whose identity changes on every reload.
  }, [openKey, loadPatch, reloadKey]);

  const toggleDir = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  }, []);

  // Attaching also selects the file and swings the sidebar to the review tab,
  // so one click goes from "this changed" to reading it in full.
  const attach = useCallback(
    (file: DiffFile) => {
      attachReviewPaths([joinPath(root, file.path)]).catch((err) =>
        console.error("attachReviewPaths failed", err),
      );
    },
    [root],
  );

  const toggleAll = useCallback(() => {
    setCollapsed((prev) => (dirPaths.every((p) => prev.has(p)) ? new Set() : new Set(dirPaths)));
  }, [dirPaths]);

  if (files.length === 0) return null;

  return (
    <div>
      {!compact && (
        <div className="mb-1 flex h-5 items-center gap-2 px-1 font-mono text-[10px] text-faint">
          <span>{t("{n} files", { n: files.length })}</span>
          <span className="flex items-center gap-1.5">
            <Stat additions={totals.additions} deletions={totals.deletions} />
          </span>
          <span className="flex-1" />
          {dirPaths.length > 0 && (
            <button
              className="grid h-5 w-5 place-items-center rounded text-faint transition-colors hover:text-accent"
              onClick={toggleAll}
              title={allCollapsed ? t("Expand all") : t("Collapse all")}
            >
              <CollapseIcon collapsed={allCollapsed} />
            </button>
          )}
        </div>
      )}

      <div className="space-y-px">
        {rows.map(({ node, depth }) => {
          if (node.kind === "dir") {
            const dir = node as TreeDirNode;
            const open = !collapsed.has(dir.path);
            return (
              <button
                key={`d:${dir.path}`}
                className="flex w-full items-center gap-1.5 rounded-md py-[3px] pr-2 text-left transition-colors hover:bg-accent/[0.07]"
                onClick={() => toggleDir(dir.path)}
                title={dir.path}
              >
                <Guides depth={depth} />
                <span className="ml-1 text-faint">
                  <Chevron open={open} />
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">
                  {dir.label}
                </span>
                <span className="shrink-0 font-mono text-[9px] text-faint">{dir.files}</span>
                <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] opacity-70">
                  <Stat additions={dir.additions} deletions={dir.deletions} />
                </span>
              </button>
            );
          }

          const file = (node as TreeFileNode).file;
          const isOpen = file.path === openPath;
          return (
            <div key={`f:${file.untracked ? "u:" : ""}${file.path}`}>
              {/* A div, not a button: the attach control nests inside the row,
                  and a button inside a button is invalid markup. */}
              <div
                className={`group flex w-full cursor-pointer items-center gap-1.5 rounded-md py-[3px] pr-1 text-left transition-colors ${
                  isOpen ? "bg-accent/10 text-accent" : "hover:bg-accent/[0.07]"
                }`}
                onClick={() => setOpenPath(isOpen ? null : file.path)}
                title={file.path}
              >
                <Guides depth={depth} />
                <span
                  className={`ml-1 h-1 w-1 shrink-0 rounded-full ${
                    file.untracked ? "bg-emerald-400/70" : "bg-faint/60"
                  }`}
                  aria-hidden
                />
                <span
                  className={`min-w-0 flex-1 truncate font-mono text-[11px] ${
                    isOpen ? "text-accent" : "text-ink"
                  }`}
                >
                  {node.label}
                </span>
                <button
                  // opacity, not display: reserving the space keeps the diff
                  // counts from jumping sideways as rows are hovered.
                  className="grid h-5 w-5 shrink-0 place-items-center rounded text-faint opacity-0 transition-colors hover:bg-ink/10 hover:text-accent group-hover:opacity-100"
                  title={t("Open in review")}
                  onClick={(e) => {
                    e.stopPropagation();
                    attach(file);
                  }}
                >
                  <ToReviewIcon />
                </button>
                <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px]">
                  {fileStat(file, t)}
                </span>
              </div>
              {isOpen && (
                <div className="my-1 overflow-hidden rounded-lg border border-accent/25 bg-ink/[0.03]">
                  {patchError ? (
                    <div className="px-3 py-2 font-mono text-[10px] break-all whitespace-pre-wrap text-red-300">
                      {patchError}
                    </div>
                  ) : patch === null ? (
                    <div className="px-3 py-2 text-[10px] text-faint">{t("Loading…")}</div>
                  ) : (
                    <Patch text={patch} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

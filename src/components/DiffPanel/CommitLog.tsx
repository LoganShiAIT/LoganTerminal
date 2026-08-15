import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { layoutCommitGraph, type GraphRow } from "../../lib/commitGraph";
import { formatAgo } from "../../lib/duration";
import type { Commit, CommitLog as Log, DiffFile, DiffSummary } from "../../lib/git";
import DiffFileTree from "./DiffFileTree";
import { useT } from "../../i18n";

/** Row height, lane pitch and node radius — the whole geometry, in px. */
const ROW_H = 26;
const LANE_W = 13;
const NODE_R = 3.4;

/** Lane 0 is the accent so the branch you are on matches the rest of the UI. */
const LANE_COLORS = [
  "var(--color-accent)",
  "#5b8def",
  "#3fa96b",
  "#a76bd8",
  "#d99a2b",
  "#2fa3a3",
];
const laneColor = (lane: number) => LANE_COLORS[lane % LANE_COLORS.length];
const laneX = (lane: number) => lane * LANE_W + LANE_W / 2;

/** The lanes still running below a row — what the expanded panel draws past. */
function continuing(row: GraphRow): number[] {
  const lanes = [...row.through, ...row.branching];
  if (row.continues) lanes.push(row.lane);
  return lanes;
}

/**
 * One row of the graph gutter: vertical lines for the lanes crossing it,
 * curves for the branches opening and closing at this commit, and the node.
 */
function GraphCell({ row, width }: { row: GraphRow; width: number }) {
  const x = laneX(row.lane);
  const mid = ROW_H / 2;
  return (
    <svg
      width={width * LANE_W}
      height={ROW_H}
      className="shrink-0"
      fill="none"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden
    >
      {row.through.map((lane) => (
        <line
          key={`t${lane}`}
          x1={laneX(lane)}
          y1={0}
          x2={laneX(lane)}
          y2={ROW_H}
          stroke={laneColor(lane)}
          opacity={0.55}
        />
      ))}
      {row.merging.map((lane) => (
        <path
          key={`m${lane}`}
          d={`M ${laneX(lane)} 0 L ${laneX(lane)} ${mid - 7} Q ${laneX(lane)} ${mid} ${x} ${mid}`}
          stroke={laneColor(lane)}
          opacity={0.75}
        />
      ))}
      {row.branching.map((lane) => (
        <path
          key={`b${lane}`}
          d={`M ${x} ${mid} Q ${laneX(lane)} ${mid} ${laneX(lane)} ${mid + 7} L ${laneX(lane)} ${ROW_H}`}
          stroke={laneColor(lane)}
          opacity={0.75}
        />
      ))}
      {row.incoming && <line x1={x} y1={0} x2={x} y2={mid} stroke={laneColor(row.lane)} />}
      {row.continues && <line x1={x} y1={mid} x2={x} y2={ROW_H} stroke={laneColor(row.lane)} />}
      <circle
        cx={x}
        cy={mid}
        r={NODE_R}
        stroke={laneColor(row.lane)}
        fill={row.commit.ahead ? laneColor(row.lane) : "var(--color-base)"}
      />
    </svg>
  );
}

function RefChip({ name }: { name: string }) {
  const tag = name.startsWith("tag: ");
  // `HEAD -> main` is the checked-out branch; the arrow is noise in a chip.
  const label = tag ? name.slice(5) : name.replace(/^HEAD -> /, "");
  const head = name.startsWith("HEAD");
  return (
    <span
      className={`shrink-0 rounded px-1 py-px font-mono text-[13px] leading-[1.4] ${
        tag
          ? "bg-amber-400/10 text-amber-300/90"
          : head
            ? "bg-accent/15 text-accent"
            : "bg-ink/[0.06] text-muted"
      }`}
      title={name}
    >
      {label}
    </span>
  );
}

function CommitDetail({ cwd, commit }: { cwd: string; commit: Commit }) {
  const t = useT();
  const [summary, setSummary] = useState<DiffSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    setError(null);
    invoke<DiffSummary>("git_commit_summary", { cwd, hash: commit.hash })
      .then((s) => !cancelled && setSummary(s))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [cwd, commit.hash]);

  const loadPatch = useCallback(
    (file: DiffFile) =>
      invoke<string>("git_commit_file", { cwd, hash: commit.hash, path: file.path }),
    [cwd, commit.hash],
  );

  return (
    <div className="rounded-lg border border-accent/25 bg-ink/[0.03] p-1.5">
      <div className="mb-1 flex items-center gap-2 px-1 font-mono text-[14px] text-faint">
        <span className="truncate">{commit.author}</span>
        <span className="flex-1" />
        <span className="shrink-0">{new Date(commit.timestamp * 1000).toLocaleString()}</span>
      </div>
      {error ? (
        <div className="px-1 py-1 font-mono text-[14px] break-all whitespace-pre-wrap text-red-300">
          {error}
        </div>
      ) : summary === null ? (
        <div className="px-1 py-1 text-[14px] text-faint">{t("Loading…")}</div>
      ) : summary.files.length === 0 ? (
        <div className="px-1 py-1 text-[14px] text-faint">
          {t("No files here — merge commits list their changes on the parents.")}
        </div>
      ) : (
        <DiffFileTree
          files={summary.files}
          root={summary.root}
          loadPatch={loadPatch}
          compact
        />
      )}
    </div>
  );
}

/**
 * Commit history as a lane graph: how this branch reached its current state,
 * and where it forked from the base. Commits ahead of the base draw a filled
 * node; inherited history draws hollow. Clicking a commit expands the files it
 * touched, each of which expands into its patch.
 */
export default function CommitLog({ cwd, log }: { cwd: string; log: Log }) {
  const t = useT();
  const [openHash, setOpenHash] = useState<string | null>(null);
  const graph = useMemo(() => layoutCommitGraph(log.commits), [log.commits]);
  const gutter = graph.width * LANE_W;
  const ahead = log.commits.filter((c) => c.ahead).length;

  // A commit that scrolled out of the window (or a pane switch) closes itself.
  useEffect(() => {
    if (openHash && !log.commits.some((c) => c.hash === openHash)) setOpenHash(null);
  }, [log.commits, openHash]);

  if (log.commits.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-edge px-3 py-3 text-[15px] leading-relaxed text-faint">
        {t("No commits yet.")}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1 flex h-5 items-center gap-2 px-1 font-mono text-[14px] text-faint">
        <span>{t("{n} commits", { n: log.commits.length })}</span>
        {log.base && ahead > 0 && (
          <span className="text-accent/80">
            {t("{n} ahead of {base}", { n: ahead, base: log.base })}
          </span>
        )}
      </div>

      {graph.rows.map((row) => {
        const { commit } = row;
        const open = commit.hash === openHash;
        return (
          <div key={commit.hash}>
            <button
              className={`flex w-full items-stretch rounded-md text-left transition-colors ${
                open ? "bg-accent/10" : "hover:bg-accent/[0.06]"
              }`}
              onClick={() => setOpenHash(open ? null : commit.hash)}
              title={`${commit.short} · ${commit.author} · ${commit.subject}`}
            >
              <GraphCell row={row} width={graph.width} />
              <span
                className="flex min-w-0 flex-1 items-center gap-1.5 pr-1"
                style={{ height: ROW_H }}
              >
                <span
                  className={`min-w-0 flex-1 truncate text-[15px] ${
                    commit.ahead ? "text-ink" : "text-muted"
                  }`}
                >
                  {commit.subject}
                </span>
                {commit.refs.slice(0, 2).map((r) => (
                  <RefChip key={r} name={r} />
                ))}
                <span className="shrink-0 font-mono text-[14px] text-faint">{commit.short}</span>
                <span
                  className="w-[34px] shrink-0 text-right font-mono text-[14px] text-faint"
                  title={new Date(commit.timestamp * 1000).toLocaleString()}
                >
                  {formatAgo(commit.timestamp)}
                </span>
              </span>
            </button>
            {open && (
              <div className="relative mb-1" style={{ paddingLeft: gutter }}>
                {/* The lanes crossing this commit keep running past the panel. */}
                {continuing(row).map((lane) => (
                  <span
                    key={lane}
                    className="absolute top-0 bottom-0 w-px"
                    style={{ left: laneX(lane) - 0.5, background: laneColor(lane), opacity: 0.45 }}
                    aria-hidden
                  />
                ))}
                <CommitDetail cwd={cwd} commit={commit} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

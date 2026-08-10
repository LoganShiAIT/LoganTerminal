import { tokenize } from "./math";

/** One row's worth of an underlined formula. */
export interface MathSegment {
  /** Index into the rows that were scanned. */
  row: number;
  /** Char index in that row where the underline starts, inclusive. */
  start: number;
  /** Char index just past the last underlined char. */
  end: number;
  /**
   * The complete formula, not just this row's slice — hovering any row of a
   * wrapped or multi-line block previews the whole thing.
   */
  value: string;
  display: boolean;
  /** Shared by every segment of one formula. */
  spanId: number;
}

/**
 * Terminal rows back into the text they represent.
 *
 * `wrapped[i]` (xterm's `IBufferLine.isWrapped`) marks a row that is the
 * continuation of the one above it: joining those without a newline undoes
 * the soft wrap, so a formula the terminal broke across two rows is still one
 * formula here. Real line breaks stay `\n` so paragraph detection works.
 *
 * `starts[i]` is the offset row `i` begins at, which is how a chunk found in
 * the joined text is mapped back onto rows and columns.
 */
export function joinRows(
  rows: string[],
  wrapped?: boolean[],
): { text: string; starts: number[] } {
  let text = "";
  const starts: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (i > 0 && !wrapped?.[i]) text += "\n";
    starts.push(text.length);
    text += rows[i];
  }
  return { text, starts };
}

/** Index of the row that owns `offset` in the joined text. */
function rowAt(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * A formula spanning more rows than this is almost certainly a mis-parse (an
 * unmatched `$` swallowing a screenful), and underlining it would paint over
 * half the output.
 */
const MAX_SPAN_ROWS = 12;

/**
 * Every formula in a stretch of terminal rows, cut into per-row segments.
 *
 * Scanning the joined text rather than each row alone is the whole point: the
 * common agent output is
 *
 *     $$
 *     \min_x c^T x
 *     $$
 *
 * where no single row carries a complete formula. xterm decorations still
 * anchor to one buffer line each, so a span that covers three rows comes back
 * as three segments that share `value` and `spanId`.
 */
export function findSegments(
  rows: string[],
  wrapped?: boolean[],
): MathSegment[] {
  const { text, starts } = joinRows(rows, wrapped);
  if (!text.includes("$") && !text.includes("\\")) return [];

  const segments: MathSegment[] = [];
  let spanId = 0;
  for (const chunk of tokenize(text)) {
    if (chunk.kind !== "math") continue;
    const first = rowAt(starts, chunk.start);
    const last = rowAt(starts, Math.max(chunk.start, chunk.end - 1));
    if (last - first >= MAX_SPAN_ROWS) continue;
    const id = spanId++;
    for (let r = first; r <= last; r++) {
      const start = Math.max(0, chunk.start - starts[r]);
      const end = Math.min(rows[r].length, chunk.end - starts[r]);
      if (end <= start) continue; // row holds only the joining newline
      segments.push({
        row: r,
        start,
        end,
        value: chunk.value,
        display: chunk.display,
        spanId: id,
      });
    }
  }
  return segments;
}

/** Cap on what auto-follow pushes into the panel — a runaway TUI repaint
 *  should never dump a whole screenful of box-drawing into the editor. */
const MAX_BLOCK_CHARS = 4000;

/**
 * The most recent formula in a stretch of terminal rows, together with the
 * blank-line-delimited paragraph around it (the "where $x_i$ is …" sentence
 * that follows a formula is usually the half you actually need).
 * Returns null when the rows carry no math at all.
 */
export function findLastMathBlock(
  rows: string[],
  wrapped?: boolean[],
): string | null {
  const { text } = joinRows(rows, wrapped);
  const chunks = tokenize(text);
  let last: { start: number; end: number } | null = null;
  for (const chunk of chunks) {
    if (chunk.kind === "math") last = { start: chunk.start, end: chunk.end };
  }
  if (!last) return null;

  const before = text.lastIndexOf("\n\n", last.start);
  const after = text.indexOf("\n\n", last.end);
  const block = text
    .slice(before === -1 ? 0 : before + 2, after === -1 ? text.length : after)
    .trim();
  return block.length > MAX_BLOCK_CHARS ? block.slice(-MAX_BLOCK_CHARS) : block;
}

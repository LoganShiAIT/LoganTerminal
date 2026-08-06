import { tokenize } from "./math";

export interface MathSpan {
  /** Column of the opening delimiter, inclusive. */
  start: number;
  /** Column just past the closing delimiter. */
  end: number;
  /** LaTeX between the delimiters. */
  value: string;
  display: boolean;
}

/**
 * Math spans inside a single terminal row.
 *
 * Row-scoped on purpose: xterm decorations anchor to one buffer line, and a
 * formula that soft-wraps has no single row to underline. Those are still
 * picked up by `findLastMathBlock`, which works on the joined text.
 */
export function findRowSpans(row: string): MathSpan[] {
  if (!row.includes("$") && !row.includes("\\")) return [];
  return tokenize(row)
    .filter((c) => c.kind === "math")
    .map((c) => ({
      start: c.start,
      end: c.end,
      value: c.value,
      display: (c as { display: boolean }).display,
    }));
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
export function findLastMathBlock(rows: string[]): string | null {
  const text = rows.join("\n");
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

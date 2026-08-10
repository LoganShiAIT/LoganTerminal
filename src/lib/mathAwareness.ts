import type {
  Terminal as XTerm,
  IBufferLine,
  IBufferCell,
} from "@xterm/xterm";
import { useSettingsStore } from "../stores/settingsStore";
import { useMathStore, useMathHoverStore } from "../stores/mathStore";
import { useUiStore } from "../stores/uiStore";
import { renderMath } from "./math";
import { findSegments, findLastMathBlock } from "./mathScan";

/** Rows of scrollback auto-follow looks back over for the newest formula. */
const MATH_TAIL_ROWS = 300;
const MATH_SCAN_DEBOUNCE_MS = 400;
/**
 * Rows scanned above and below the viewport for underlines. Decorations only
 * render while their line is on screen, so the window follows the viewport
 * instead of the buffer end — scroll back a page and the formulas up there
 * still light up.
 */
const MATH_VIEW_MARGIN = 80;
/** Ceiling on live decorations — a screenful of formulas is already a lot. */
const MAX_MATH_DECORATIONS = 80;

/**
 * Maps each character index of a row's text to the terminal column it starts
 * at. `translateToString` collapses a wide (CJK) cell into one JS character
 * while it occupies two columns, so decoration coordinates derived from
 * string indices drift right after any Chinese text. Walking the cells is the
 * only public way to recover the real columns. Index `length` holds the
 * column just past the last character, so callers can measure a span's end.
 */
export function columnMap(
  line: IBufferLine | undefined,
  length: number,
  cell: IBufferCell,
): number[] {
  const columns: number[] = [];
  if (!line) return columns;
  for (let x = 0; x < line.length && columns.length <= length; x++) {
    if (!line.getCell(x, cell)) continue;
    if (cell.getWidth() === 0) continue; // trailing half of a wide char
    const chars = cell.getChars() || " ";
    for (let k = 0; k < chars.length; k++) columns.push(x);
    if (columns.length > length) break;
  }
  columns.push(columns.length > 0 ? columns[columns.length - 1] + 1 : 0);
  return columns;
}

/** One underline to place: a buffer line and the columns it covers. */
interface Placement {
  line: number;
  x: number;
  width: number;
  value: string;
  display: boolean;
}

function signature(places: Placement[]): string {
  return places
    .map((p) => `${p.line}:${p.x}:${p.width}:${p.display ? 1 : 0}:${p.value}`)
    .join("|");
}

export interface MathAwareness {
  /** Debounced rescan of the buffer. */
  scheduleScan: () => void;
  /** Drop every live decoration now (e.g. the feature was switched off). */
  clearDecorations: () => void;
  dispose: () => void;
}

/**
 * Math awareness for one terminal: auto-follow (push the newest formula into
 * the Math panel) and the inline underline + hover preview. Decorations are
 * the only supported way to put our own DOM over the grid — xterm itself
 * renders text only.
 *
 * `isActive` gates auto-follow: only the pane the user is actually watching
 * may hijack the shared panel.
 */
export function installMathAwareness(
  term: XTerm,
  { isActive }: { isActive: () => boolean },
): MathAwareness {
  let scanTimer: number | null = null;
  let disposables: Array<{ dispose: () => void }> = [];
  /** What `disposables` currently draws, so an unchanged buffer is a no-op. */
  let placed = "";

  const clearDecorations = () => {
    for (const d of disposables) d.dispose();
    disposables = [];
    placed = "";
    // A hovered element that gets disposed never fires mouseleave, which
    // would strand the popover on screen.
    useMathHoverStore.getState().hide();
  };

  const decorateSpan = (el: HTMLElement, place: Placement) => {
    // classList.add, never className: xterm's own `xterm-decoration` class
    // carries the absolute positioning that puts this element over the grid.
    el.classList.add("math-underline");
    // Property assignment (not addEventListener): onRender fires again on
    // every re-render and must not stack handlers.
    el.onmouseenter = () => {
      const rect = el.getBoundingClientRect();
      useMathHoverStore.getState().show({
        html: renderMath(place.value, place.display),
        anchor: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        },
      });
    };
    el.onmouseleave = () => useMathHoverStore.getState().hide();
    el.onclick = () => {
      useMathHoverStore.getState().hide();
      useMathStore
        .getState()
        .setSource(
          place.display ? `$$${place.value}$$` : `$${place.value}$`,
          "selection",
        );
      useUiStore.getState().openRightPanel("math");
    };
  };

  /** Row text plus the soft-wrap flags needed to un-wrap it. */
  const readRows = (top: number, bottom: number) => {
    const buf = term.buffer.active;
    const rows: string[] = [];
    const wrapped: boolean[] = [];
    for (let y = top; y < bottom; y++) {
      const line = buf.getLine(y);
      rows.push(line?.translateToString(true) ?? "");
      wrapped.push(line?.isWrapped ?? false);
    }
    return { rows, wrapped };
  };

  const scan = () => {
    const settings = useSettingsStore.getState();
    if (!settings.mathInline && !settings.mathAutoFollow) {
      clearDecorations();
      return;
    }
    const buf = term.buffer.active;
    // The alternate buffer belongs to a full-screen program (vim, less, a
    // TUI): xterm hides decorations while it is up and the buffer is thrown
    // away on exit, so anything registered against it is invisible work.
    if (buf.type === "alternate") {
      clearDecorations();
      return;
    }
    const end = buf.baseY + term.rows;

    if (settings.mathAutoFollow && isActive()) {
      const top = Math.max(0, end - MATH_TAIL_ROWS);
      const tail = readRows(top, end);
      const block = findLastMathBlock(tail.rows, tail.wrapped);
      if (block) useMathStore.getState().autoFollow(block);
    }

    if (!settings.mathInline) {
      clearDecorations();
      return;
    }

    const top = Math.max(0, buf.viewportY - MATH_VIEW_MARGIN);
    const bottom = Math.min(end, buf.viewportY + term.rows + MATH_VIEW_MARGIN);
    const view = readRows(top, bottom);
    const segments = findSegments(view.rows, view.wrapped);

    const nullCell = buf.getNullCell();
    const columnCache = new Map<number, number[]>();
    const wanted: Placement[] = [];
    for (const seg of segments) {
      // String index ≠ terminal column once CJK is on the line (one char,
      // two cells), so map through the actual cells before positioning.
      let columns = columnCache.get(seg.row);
      if (!columns) {
        columns = columnMap(
          buf.getLine(top + seg.row),
          view.rows[seg.row].length,
          nullCell,
        );
        columnCache.set(seg.row, columns);
      }
      const x = columns[seg.start] ?? seg.start;
      const endX =
        columns[seg.end] ?? (columns[columns.length - 1] ?? seg.end) + 1;
      wanted.push({
        line: top + seg.row,
        x,
        width: Math.max(1, endX - x),
        value: seg.value,
        display: seg.display,
      });
    }
    // Over the cap, keep the newest: the formula that just scrolled in
    // matters more than one 200 rows up.
    const keep =
      wanted.length > MAX_MATH_DECORATIONS
        ? wanted.slice(-MAX_MATH_DECORATIONS)
        : wanted;

    // Rebuilding identical decorations every 400ms would tear the element out
    // from under the pointer mid-hover and flicker the underline.
    // Scrollback trimming shifts absolute line numbers, so a stale marker can
    // never hide behind an unchanged signature.
    const next = signature(keep);
    if (next === placed) return;
    clearDecorations();

    const cursorLine = buf.baseY + buf.cursorY;
    for (const place of keep) {
      const marker = term.registerMarker(place.line - cursorLine);
      if (!marker) continue;
      const decoration = term.registerDecoration({
        marker,
        x: place.x,
        width: place.width,
        height: 1,
        layer: "top",
      });
      if (!decoration) {
        marker.dispose();
        continue;
      }
      decoration.onRender((el) => decorateSpan(el, place));
      disposables.push(decoration, marker);
    }
    placed = disposables.length > 0 ? next : "";
  };

  const scheduleScan = () => {
    if (scanTimer !== null) window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scan, MATH_SCAN_DEBOUNCE_MS);
  };

  // A reflow re-wraps every row, so all column positions are stale.
  const resizeDisposable = term.onResize(scheduleScan);
  // Scrolling brings rows the last scan never looked at into view.
  const scrollDisposable = term.onScroll(scheduleScan);
  // Leaving the alternate buffer restores output that needs decorating again.
  const bufferDisposable = term.buffer.onBufferChange(scheduleScan);

  return {
    scheduleScan,
    clearDecorations,
    dispose: () => {
      if (scanTimer !== null) window.clearTimeout(scanTimer);
      resizeDisposable.dispose();
      scrollDisposable.dispose();
      bufferDisposable.dispose();
      clearDecorations();
    },
  };
}

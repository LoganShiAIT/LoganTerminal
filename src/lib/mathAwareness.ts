import type {
  Terminal as XTerm,
  IBufferLine,
  IBufferCell,
} from "@xterm/xterm";
import { useSettingsStore } from "../stores/settingsStore";
import { useMathStore, useMathHoverStore } from "../stores/mathStore";
import { useUiStore } from "../stores/uiStore";
import { renderMath } from "./math";
import { findRowSpans, findLastMathBlock, type MathSpan } from "./mathScan";

/** Rows of scrollback the math scan looks back over. */
const MATH_SCAN_ROWS = 300;
const MATH_SCAN_DEBOUNCE_MS = 400;
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

export interface MathAwareness {
  /** Debounced rescan of the buffer tail. */
  scheduleScan: () => void;
  /** Drop every live decoration now (e.g. the feature was switched off). */
  clearDecorations: () => void;
  dispose: () => void;
}

/**
 * Math awareness for one terminal. A single debounced scan of the tail of the
 * buffer feeds both features: auto-follow (push the newest formula into the
 * Math panel) and the inline underline + hover preview. Decorations are the
 * only supported way to put our own DOM over the grid — xterm itself renders
 * text only.
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

  const clearDecorations = () => {
    for (const d of disposables) d.dispose();
    disposables = [];
  };

  const decorateSpan = (el: HTMLElement, span: MathSpan) => {
    // classList.add, never className: xterm's own `xterm-decoration` class
    // carries the absolute positioning that puts this element over the grid.
    el.classList.add("math-underline");
    // Property assignment (not addEventListener): onRender fires again on
    // every re-render and must not stack handlers.
    el.onmouseenter = () => {
      const rect = el.getBoundingClientRect();
      useMathHoverStore.getState().show({
        html: renderMath(span.value, span.display),
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
          span.display ? `$$${span.value}$$` : `$${span.value}$`,
          "selection",
        );
      useUiStore.getState().openRightPanel("math");
    };
  };

  const scan = () => {
    const settings = useSettingsStore.getState();
    if (!settings.mathInline && !settings.mathAutoFollow) {
      clearDecorations();
      return;
    }
    const buf = term.buffer.active;
    const bottom = buf.baseY + term.rows;
    const top = Math.max(0, bottom - MATH_SCAN_ROWS);
    const rows: string[] = [];
    for (let y = top; y < bottom; y++) {
      rows.push(buf.getLine(y)?.translateToString(true) ?? "");
    }

    if (settings.mathAutoFollow && isActive()) {
      const block = findLastMathBlock(rows);
      if (block) useMathStore.getState().autoFollow(block);
    }

    clearDecorations();
    if (!settings.mathInline) return;

    const cursorLine = buf.baseY + buf.cursorY;
    const nullCell = buf.getNullCell();
    let placed = 0;
    for (let i = 0; i < rows.length && placed < MAX_MATH_DECORATIONS; i++) {
      const spans = findRowSpans(rows[i]);
      if (spans.length === 0) continue;
      // String index ≠ terminal column once CJK is on the line (one char,
      // two cells), so map through the actual cells before positioning.
      const columns = columnMap(buf.getLine(top + i), rows[i].length, nullCell);
      for (const span of spans) {
        if (placed >= MAX_MATH_DECORATIONS) break;
        const marker = term.registerMarker(top + i - cursorLine);
        if (!marker) continue;
        const x = columns[span.start] ?? span.start;
        const endX =
          columns[span.end] ?? (columns[columns.length - 1] ?? span.end) + 1;
        const decoration = term.registerDecoration({
          marker,
          x,
          width: Math.max(1, endX - x),
          height: 1,
          layer: "top",
        });
        if (!decoration) {
          marker.dispose();
          continue;
        }
        decoration.onRender((el) => decorateSpan(el, span));
        disposables.push(decoration, marker);
        placed++;
      }
    }
  };

  const scheduleScan = () => {
    if (scanTimer !== null) window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scan, MATH_SCAN_DEBOUNCE_MS);
  };

  // A reflow re-wraps every row, so all column positions are stale.
  const resizeDisposable = term.onResize(scheduleScan);

  return {
    scheduleScan,
    clearDecorations,
    dispose: () => {
      if (scanTimer !== null) window.clearTimeout(scanTimer);
      resizeDisposable.dispose();
      clearDecorations();
      useMathHoverStore.getState().hide();
    },
  };
}

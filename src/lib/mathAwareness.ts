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
 * Rows scanned above and below the viewport for underlines. Only visible rows
 * are painted; the margin is what makes a small scroll reposition instantly
 * instead of waiting for the next scan.
 */
const MATH_VIEW_MARGIN = 60;
/** Ceiling on live underlines — a screenful of formulas is already a lot. */
const MAX_MATH_UNDERLINES = 80;

/**
 * Maps each character index of a row's text to the terminal column it starts
 * at. `translateToString` collapses a wide (CJK) cell into one JS character
 * while it occupies two columns, so coordinates derived from string indices
 * drift right after any Chinese text. Walking the cells is the only public
 * way to recover the real columns. Index `length` holds the column just past
 * the last character, so callers can measure a span's end.
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

/** One underline: a buffer line and the columns it covers. */
export interface Placement {
  /** Absolute buffer line, not a viewport row. */
  line: number;
  x: number;
  width: number;
  value: string;
  display: boolean;
  /** Shared by every row of one formula, so hovering lights all of them. */
  spanId: number;
}

const keyOf = (p: Placement) => `${p.line}:${p.x}:${p.width}:${p.value}`;

export interface MathAwareness {
  /** Debounced rescan of the buffer. */
  scheduleScan: () => void;
  /** Drop every underline now (e.g. the feature was switched off). */
  clearUnderlines: () => void;
  dispose: () => void;
}

/**
 * Math awareness for one terminal: auto-follow (push the newest formula into
 * the Math panel) and the inline underline + hover preview.
 *
 * **Why not xterm decorations.** They were the obvious tool and the first
 * implementation used them, but `BufferDecorationRenderer` hard-codes
 * `display: none` on every decoration while the alternate buffer is active —
 * which is exactly where an agent TUI (opencode, claude in full-screen mode,
 * anything bubbletea-based) lives. The underline was structurally invisible
 * for the main use case. So the overlay is ours: one absolutely-positioned
 * layer inside `.xterm-screen`, placed from cell metrics, which works
 * identically in both buffers.
 *
 * The layer is `pointer-events: none` and hover is hit-tested from mouse
 * coordinates instead: an interactive element over the grid would eat the
 * mousedown that starts a text selection.
 *
 * `isActive` gates auto-follow: only the pane the user is actually watching
 * may hijack the shared panel.
 */
export function installMathAwareness(
  term: XTerm,
  { isActive }: { isActive: () => boolean },
): MathAwareness {
  let scanTimer: number | null = null;
  let placements: Placement[] = [];
  let hovered: Placement | null = null;
  /** What is currently painted, so scans that change nothing don't repaint. */
  let painted = "";
  let layer: HTMLElement | null = null;
  let cellW = 0;
  let cellH = 0;

  const screenEl = () =>
    term.element?.querySelector<HTMLElement>(".xterm-screen") ?? null;

  /**
   * xterm sizes `.xterm-screen` to exactly cols×rows cells, so dividing it is
   * an exact cell size without reaching into private renderer internals.
   */
  const measure = (screen: HTMLElement) => {
    cellW = screen.clientWidth / Math.max(1, term.cols);
    cellH = screen.clientHeight / Math.max(1, term.rows);
    return cellW > 0 && cellH > 0;
  };

  const setHovered = (next: Placement | null) => {
    if (hovered && next && keyOf(hovered) === keyOf(next)) {
      hovered = next; // same formula, refreshed placement object
      return;
    }
    hovered = next;
    if (layer) {
      for (const el of layer.querySelectorAll(".math-underline-active")) {
        el.classList.remove("math-underline-active");
      }
      if (next) {
        for (const el of layer.querySelectorAll(
          `[data-math-span="${next.spanId}"]`,
        )) {
          el.classList.add("math-underline-active");
        }
      }
    }
    if (!next) {
      useMathHoverStore.getState().hide();
      return;
    }
    const screen = screenEl();
    if (!screen) return;
    const rect = screen.getBoundingClientRect();
    const top = rect.top + (next.line - term.buffer.active.viewportY) * cellH;
    const left = rect.left + next.x * cellW;
    useMathHoverStore.getState().show({
      html: renderMath(next.value, next.display),
      anchor: {
        left,
        top,
        right: left + next.width * cellW,
        bottom: top + cellH,
      },
    });
  };

  /** Draw the placements that fall inside the viewport right now. */
  const paint = () => {
    const screen = screenEl();
    if (!screen || !measure(screen)) return;
    if (!layer || !layer.isConnected) {
      layer = document.createElement("div");
      layer.className = "math-layer";
      screen.appendChild(layer);
    }
    const viewportY = term.buffer.active.viewportY;
    painted = `${viewportY}|${placements.map(keyOf).join("|")}`;
    layer.replaceChildren();
    for (const p of placements) {
      const row = p.line - viewportY;
      if (row < 0 || row >= term.rows) continue;
      const el = document.createElement("div");
      el.className = "math-underline";
      if (hovered && hovered.spanId === p.spanId) {
        el.classList.add("math-underline-active");
      }
      el.dataset.mathSpan = String(p.spanId);
      el.style.left = `${p.x * cellW}px`;
      el.style.top = `${row * cellH}px`;
      el.style.width = `${p.width * cellW}px`;
      el.style.height = `${cellH}px`;
      layer.appendChild(el);
    }
  };

  const clearUnderlines = () => {
    placements = [];
    hovered = null;
    painted = "";
    layer?.remove();
    layer = null;
    useMathHoverStore.getState().hide();
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

  /** Last seen pointer position, so a rescan can re-hit-test in place. */
  let lastX = -1;
  let lastY = -1;

  const hitTest = (clientX: number, clientY: number): Placement | null => {
    const screen = screenEl();
    if (!screen || placements.length === 0 || cellW <= 0 || cellH <= 0) {
      return null;
    }
    const rect = screen.getBoundingClientRect();
    const col = Math.floor((clientX - rect.left) / cellW);
    const line =
      Math.floor((clientY - rect.top) / cellH) + term.buffer.active.viewportY;
    return (
      placements.find(
        (p) => p.line === line && col >= p.x && col < p.x + p.width,
      ) ?? null
    );
  };

  const scan = () => {
    const settings = useSettingsStore.getState();
    if (!settings.mathInline && !settings.mathAutoFollow) {
      clearUnderlines();
      return;
    }
    const buf = term.buffer.active;
    // The alternate buffer has no scrollback: baseY is 0 and everything there
    // is on screen. Both features still run — this is where agent TUIs print.
    const end = buf.baseY + term.rows;

    if (settings.mathAutoFollow && isActive()) {
      const from = Math.max(0, end - MATH_TAIL_ROWS);
      const tail = readRows(from, end);
      const block = findLastMathBlock(tail.rows, tail.wrapped);
      if (block) useMathStore.getState().autoFollow(block);
    }

    if (!settings.mathInline) {
      clearUnderlines();
      return;
    }

    const top = Math.max(0, buf.viewportY - MATH_VIEW_MARGIN);
    const bottom = Math.min(end, buf.viewportY + term.rows + MATH_VIEW_MARGIN);
    const view = readRows(top, bottom);
    const segments = findSegments(view.rows, view.wrapped);

    const nullCell = buf.getNullCell();
    const columnCache = new Map<number, number[]>();
    const found: Placement[] = [];
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
      found.push({
        line: top + seg.row,
        x,
        width: Math.max(1, endX - x),
        value: seg.value,
        display: seg.display,
        spanId: seg.spanId,
      });
    }
    // Over the cap, keep the newest: the formula that just scrolled in
    // matters more than one 200 rows up.
    placements =
      found.length > MAX_MATH_UNDERLINES
        ? found.slice(-MAX_MATH_UNDERLINES)
        : found;

    if (`${buf.viewportY}|${placements.map(keyOf).join("|")}` === painted) {
      return;
    }
    paint();
    if (hovered) setHovered(hitTest(lastX, lastY));
  };

  const scheduleScan = () => {
    if (scanTimer !== null) window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scan, MATH_SCAN_DEBOUNCE_MS);
  };

  const onMouseMove = (e: MouseEvent) => {
    lastX = e.clientX;
    lastY = e.clientY;
    if (placements.length === 0 && !hovered) return;
    setHovered(hitTest(e.clientX, e.clientY));
  };

  const onMouseLeave = () => setHovered(null);

  const onClick = () => {
    const hit = hovered;
    if (!hit) return;
    // A drag that ended on a formula was a selection, not a click on it.
    if (term.hasSelection()) return;
    setHovered(null);
    useMathStore
      .getState()
      .setSource(
        hit.display ? `$$${hit.value}$$` : `$${hit.value}$`,
        "selection",
      );
    useUiStore.getState().openSidebarPanel("math");
  };

  const root = term.element;
  root?.addEventListener("mousemove", onMouseMove);
  root?.addEventListener("mouseleave", onMouseLeave);
  root?.addEventListener("click", onClick);

  // A reflow re-wraps every row, so all columns and cell sizes are stale.
  const resizeDisposable = term.onResize(() => {
    clearUnderlines();
    scheduleScan();
  });
  // Scrolling moves existing underlines: reposition now, rescan for the rows
  // that just came in from beyond the margin.
  const scrollDisposable = term.onScroll(() => {
    if (placements.length > 0) paint();
    scheduleScan();
  });
  // Switching between the normal and alternate buffer replaces the screen.
  const bufferDisposable = term.buffer.onBufferChange(() => {
    clearUnderlines();
    scheduleScan();
  });

  return {
    scheduleScan,
    clearUnderlines,
    dispose: () => {
      if (scanTimer !== null) window.clearTimeout(scanTimer);
      root?.removeEventListener("mousemove", onMouseMove);
      root?.removeEventListener("mouseleave", onMouseLeave);
      root?.removeEventListener("click", onClick);
      resizeDisposable.dispose();
      scrollDisposable.dispose();
      bufferDisposable.dispose();
      clearUnderlines();
    },
  };
}

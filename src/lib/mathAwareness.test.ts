import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { Terminal as XTerm } from "@xterm/xterm";
import { installMathAwareness } from "./mathAwareness";
import { useMathStore, useMathHoverStore } from "../stores/mathStore";
import { useSettingsStore } from "../stores/settingsStore";

/**
 * A terminal stand-in built from plain rows. xterm itself cannot be
 * instantiated under jsdom (it measures a real DOM), but the overlay path
 * only needs the buffer API plus a `.xterm-screen` element of a known size —
 * and that is exactly the part with the column and cell arithmetic worth
 * testing.
 */
const CELL_W = 8;
const CELL_H = 16;
const COLS = 40;
const ROWS = 24;

function isWide(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return code >= 0x2e80 && code <= 0xffe6;
}

function makeLine(text: string, wrapped: boolean) {
  const cells: Array<{ chars: string; width: number }> = [];
  for (const ch of text) {
    cells.push({ chars: ch, width: isWide(ch) ? 2 : 1 });
    if (isWide(ch)) cells.push({ chars: "", width: 0 });
  }
  return {
    length: cells.length,
    isWrapped: wrapped,
    translateToString: () => text,
    getCell: (x: number, cell: { chars: string; width: number }) => {
      const src = cells[x];
      if (!src) return undefined;
      cell.chars = src.chars;
      cell.width = src.width;
      return cell;
    },
  };
}

function makeTerm(
  rows: string[],
  opts: { wrapped?: boolean[]; alternate?: boolean; viewportY?: number } = {},
) {
  const lines = rows.map((r, i) => makeLine(r, opts.wrapped?.[i] ?? false));
  const handlers: Record<string, () => void> = {};
  const listen = (name: string) => (fn: () => void) => {
    handlers[name] = fn;
    return { dispose: () => delete handlers[name] };
  };

  const root = document.createElement("div");
  const screen = document.createElement("div");
  screen.className = "xterm-screen";
  root.appendChild(screen);
  document.body.appendChild(root);
  // jsdom has no layout, so hand xterm's own screen sizing to the code.
  Object.defineProperty(screen, "clientWidth", { value: COLS * CELL_W });
  Object.defineProperty(screen, "clientHeight", { value: ROWS * CELL_H });
  screen.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: COLS * CELL_W,
      bottom: ROWS * CELL_H,
      width: COLS * CELL_W,
      height: ROWS * CELL_H,
    }) as DOMRect;

  const buffer = {
    type: opts.alternate ? "alternate" : "normal",
    baseY: opts.alternate ? 0 : Math.max(0, rows.length - ROWS),
    cursorY: Math.min(rows.length - 1, ROWS - 1),
    viewportY: opts.viewportY ?? Math.max(0, rows.length - ROWS),
    getLine: (y: number) => lines[y],
    getNullCell: () => ({
      chars: "",
      width: 1,
      getChars() {
        return this.chars;
      },
      getWidth() {
        return this.width;
      },
    }),
  };
  const term = {
    cols: COLS,
    rows: ROWS,
    element: root,
    buffer: { active: buffer, onBufferChange: listen("buffer") },
    hasSelection: () => false,
    onResize: listen("resize"),
    onScroll: listen("scroll"),
  };
  const underlines = () =>
    Array.from(screen.querySelectorAll<HTMLElement>(".math-underline"));
  return {
    term: term as unknown as XTerm,
    root,
    buffer,
    underlines,
    handlers,
  };
}

/** Mouse position of the centre of one cell. */
function cellPoint(col: number, row: number) {
  return {
    clientX: col * CELL_W + CELL_W / 2,
    clientY: row * CELL_H + CELL_H / 2,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
  useSettingsStore.setState({ mathInline: true, mathAutoFollow: true });
  useMathStore.setState({ source: "", origin: "manual", manualHold: false });
  useMathHoverStore.setState({ hover: null });
});

afterEach(() => {
  vi.useRealTimers();
});

function run(term: XTerm, active = true) {
  const math = installMathAwareness(term, { isActive: () => active });
  math.scheduleScan();
  vi.advanceTimersByTime(500);
  return math;
}

describe("installMathAwareness underlines", () => {
  it("draws an underline over the formula's cells", () => {
    const { term, underlines } = makeTerm(["so $x^2$ then"]);
    run(term);
    expect(underlines()).toHaveLength(1);
    const el = underlines()[0];
    expect(el.style.left).toBe(`${3 * CELL_W}px`);
    expect(el.style.width).toBe(`${5 * CELL_W}px`);
    expect(el.style.height).toBe(`${CELL_H}px`);
  });

  it("shifts columns past wide CJK characters", () => {
    // 8 chars before the `$`, but 12 columns: each 中-class char is 2 cells.
    const { term, underlines } = makeTerm(["其中系数 $c_i$"]);
    run(term);
    expect(underlines()[0].style.left).toBe(`${9 * CELL_W}px`);
  });

  it("underlines every row of a block whose delimiters stand alone", () => {
    const { term, underlines } = makeTerm(["$$", "\\min_x c^T x", "$$"]);
    run(term);
    expect(underlines()).toHaveLength(3);
    expect(underlines().map((el) => el.style.top)).toEqual([
      "0px",
      `${CELL_H}px`,
      `${2 * CELL_H}px`,
    ]);
  });

  it("works on the alternate buffer, where agent TUIs live", () => {
    // xterm's own decorations are display:none for the whole alt buffer,
    // which is why this overlay exists at all.
    const { term, underlines } = makeTerm(["so $x^2$ then"], {
      alternate: true,
    });
    run(term);
    expect(underlines()).toHaveLength(1);
  });

  it("only paints rows inside the viewport", () => {
    const rows = Array.from({ length: 60 }, (_, i) => `row $x_{${i}}$`);
    const { term, underlines } = makeTerm(rows, { viewportY: 36 });
    run(term);
    expect(underlines()).toHaveLength(ROWS);
  });

  it("keeps the newest formulas when over the cap", () => {
    // 140 rows in the scan window, capped to the last 80 (lines 120–199), all
    // of which the viewport at 120 can show. Dropping the newest instead
    // would leave the bottom four rows of the screen bare.
    const rows = Array.from({ length: 200 }, (_, i) => `row $x_{${i}}$`);
    const { term, underlines } = makeTerm(rows, { viewportY: 120 });
    run(term);
    expect(underlines()).toHaveLength(ROWS);
  });

  it("repositions on scroll without waiting for a rescan", () => {
    const rows = Array.from({ length: 60 }, (_, i) =>
      i === 40 ? "the $x^2$ one" : `row ${i}`,
    );
    const { term, buffer, underlines, handlers } = makeTerm(rows, {
      viewportY: 36,
    });
    run(term);
    expect(underlines()[0].style.top).toBe(`${(40 - 36) * CELL_H}px`);
    buffer.viewportY = 30;
    handlers.scroll();
    // Repainted synchronously — the debounced rescan has not run yet.
    expect(underlines()[0].style.top).toBe(`${(40 - 30) * CELL_H}px`);
  });

  it("places nothing while inline math is off", () => {
    useSettingsStore.setState({ mathInline: false });
    const { term, underlines } = makeTerm(["so $x^2$ then"]);
    run(term);
    expect(underlines()).toHaveLength(0);
  });

  it("tears the overlay down on dispose", () => {
    const { term, underlines } = makeTerm(["so $x^2$ then"]);
    const math = run(term);
    math.dispose();
    expect(underlines()).toHaveLength(0);
  });
});

describe("installMathAwareness hover", () => {
  it("previews the formula under the pointer", () => {
    const { term, root } = makeTerm(["so $x^2$ then"]);
    run(term);
    root.dispatchEvent(new MouseEvent("mousemove", cellPoint(5, 0)));
    const hover = useMathHoverStore.getState().hover;
    expect(hover).not.toBeNull();
    expect(hover!.html).toContain("katex");
    expect(hover!.anchor.left).toBe(3 * CELL_W);
  });

  it("previews the whole block from any of its rows", () => {
    const { term, root } = makeTerm(["$$", "a+b", "$$"]);
    run(term);
    root.dispatchEvent(new MouseEvent("mousemove", cellPoint(0, 2)));
    expect(useMathHoverStore.getState().hover).not.toBeNull();
    // Every row of the block lights up together.
    expect(document.querySelectorAll(".math-underline-active")).toHaveLength(3);
  });

  it("hides again when the pointer moves off the formula", () => {
    const { term, root } = makeTerm(["so $x^2$ then"]);
    run(term);
    root.dispatchEvent(new MouseEvent("mousemove", cellPoint(5, 0)));
    root.dispatchEvent(new MouseEvent("mousemove", cellPoint(20, 0)));
    expect(useMathHoverStore.getState().hover).toBeNull();
  });

  it("ignores cells outside the underline", () => {
    const { term, root } = makeTerm(["so $x^2$ then"]);
    run(term);
    root.dispatchEvent(new MouseEvent("mousemove", cellPoint(1, 0)));
    expect(useMathHoverStore.getState().hover).toBeNull();
  });

  it("sends a clicked formula to the math panel", () => {
    const { term, root } = makeTerm(["so $x^2$ then"]);
    run(term);
    root.dispatchEvent(new MouseEvent("mousemove", cellPoint(5, 0)));
    root.dispatchEvent(new MouseEvent("click"));
    expect(useMathStore.getState().source).toBe("$x^2$");
    expect(useMathStore.getState().origin).toBe("selection");
    expect(useMathHoverStore.getState().hover).toBeNull();
  });

  it("keeps the popover up across a rescan that changed nothing", () => {
    const { term, root } = makeTerm(["so $x^2$ then"]);
    const math = run(term);
    root.dispatchEvent(new MouseEvent("mousemove", cellPoint(5, 0)));
    const first = useMathHoverStore.getState().hover;
    math.scheduleScan();
    vi.advanceTimersByTime(500);
    expect(useMathHoverStore.getState().hover).toBe(first);
  });
});

describe("installMathAwareness auto-follow", () => {
  it("pushes the newest formula's paragraph into the panel", () => {
    const { term } = makeTerm(["intro", "", "$$c^T x$$", "where $x$ decides"]);
    run(term);
    expect(useMathStore.getState().source).toBe("$$c^T x$$\nwhere $x$ decides");
    expect(useMathStore.getState().origin).toBe("auto");
  });

  it("follows the alternate buffer too", () => {
    // The agent TUI case: no scrollback, everything is on screen.
    const { term } = makeTerm(["$$\\sigma_u=\\sqrt{n}$$"], { alternate: true });
    run(term);
    expect(useMathStore.getState().source).toBe("$$\\sigma_u=\\sqrt{n}$$");
  });

  it("only the watched pane may take the panel", () => {
    const { term } = makeTerm(["$$c^T x$$"]);
    run(term, false);
    expect(useMathStore.getState().source).toBe("");
  });

  it("follows again after a restart even with a restored scratch", () => {
    // The old gate was `origin === "manual" && source`, which every restart
    // reproduced — auto-follow never fired again.
    useMathStore.setState({
      source: "yesterday's draft",
      origin: "manual",
      manualHold: false,
    });
    const { term } = makeTerm(["$$c^T x$$"]);
    run(term);
    expect(useMathStore.getState().source).toBe("$$c^T x$$");
  });

  it("yields to a scratch edited in this session", () => {
    useMathStore.getState().setSource("mine", "manual");
    const { term } = makeTerm(["$$c^T x$$"]);
    run(term);
    expect(useMathStore.getState().source).toBe("mine");
  });

  it("resumes following once the scratch is cleared", () => {
    useMathStore.getState().setSource("mine", "manual");
    useMathStore.getState().setSource("", "auto");
    const { term } = makeTerm(["$$c^T x$$"]);
    run(term);
    expect(useMathStore.getState().source).toBe("$$c^T x$$");
  });
});

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { Terminal as XTerm } from "@xterm/xterm";
import { installMathAwareness } from "./mathAwareness";
import { useMathStore, useMathHoverStore } from "../stores/mathStore";
import { useSettingsStore } from "../stores/settingsStore";

/**
 * A buffer stand-in built from plain rows. xterm can't be instantiated under
 * jsdom (it measures a real DOM), but the decoration path only needs the
 * buffer/marker/decoration API, and that is exactly the part with the column
 * arithmetic worth testing.
 */
function isWide(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return code >= 0x1100 && code <= 0xffe6 && code >= 0x2e80;
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

interface FakeDecoration {
  options: { x: number; width: number; height: number; layer: string };
  line: number;
  el: HTMLElement;
  disposed: boolean;
}

function makeTerm(
  rows: string[],
  opts: { wrapped?: boolean[]; alternate?: boolean; viewportY?: number } = {},
) {
  const lines = rows.map((r, i) => makeLine(r, opts.wrapped?.[i] ?? false));
  const decorations: FakeDecoration[] = [];
  const handlers: Record<string, () => void> = {};
  const listen = (name: string) => (fn: () => void) => {
    handlers[name] = fn;
    return { dispose: () => delete handlers[name] };
  };
  const buffer = {
    type: opts.alternate ? "alternate" : "normal",
    baseY: Math.max(0, rows.length - 24),
    cursorY: Math.min(rows.length - 1, 23),
    viewportY: opts.viewportY ?? Math.max(0, rows.length - 24),
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
  let markerLine = 0;
  const term = {
    rows: 24,
    buffer: { active: buffer, onBufferChange: listen("buffer") },
    onResize: listen("resize"),
    onScroll: listen("scroll"),
    registerMarker: (offset: number) => {
      markerLine = buffer.baseY + buffer.cursorY + offset;
      return { line: markerLine, dispose: vi.fn() };
    },
    registerDecoration: (options: FakeDecoration["options"]) => {
      const dec: FakeDecoration = {
        options,
        line: markerLine,
        el: document.createElement("div"),
        disposed: false,
      };
      decorations.push(dec);
      return {
        onRender: (fn: (el: HTMLElement) => void) => fn(dec.el),
        dispose: () => {
          dec.disposed = true;
        },
      };
    },
  };
  return {
    term: term as unknown as XTerm,
    decorations,
    live: () => decorations.filter((d) => !d.disposed),
    handlers,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
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

describe("installMathAwareness decorations", () => {
  it("underlines an inline formula at the right columns", () => {
    const { term, live } = makeTerm(["so $x^2$ then"]);
    run(term);
    expect(live()).toHaveLength(1);
    expect(live()[0].options).toMatchObject({ x: 3, width: 5, height: 1 });
    expect(live()[0].el.classList.contains("math-underline")).toBe(true);
  });

  it("shifts columns past wide CJK characters", () => {
    // 8 chars before the `$`, but 12 columns: each 中-class char is 2 cells.
    const { term, live } = makeTerm(["其中系数 $c_i$"]);
    run(term);
    expect(live()[0].options.x).toBe(9);
  });

  it("underlines every row of a block whose delimiters stand alone", () => {
    const { term, live } = makeTerm(["$$", "\\min_x c^T x", "$$"]);
    run(term);
    expect(live()).toHaveLength(3);
    expect(live().map((d) => d.line)).toEqual([0, 1, 2]);
  });

  it("previews the whole formula from any row of the block", () => {
    const { term, live } = makeTerm(["$$", "a+b", "$$"]);
    run(term);
    live()[2].el.dispatchEvent(new MouseEvent("mouseenter"));
    const hover = useMathHoverStore.getState().hover;
    expect(hover).not.toBeNull();
    expect(hover!.html).toContain("katex");
  });

  it("sends a clicked formula to the math panel", () => {
    const { term, live } = makeTerm(["so $x^2$ then"]);
    run(term);
    live()[0].el.dispatchEvent(new MouseEvent("click"));
    expect(useMathStore.getState().source).toBe("$x^2$");
    expect(useMathStore.getState().origin).toBe("selection");
    expect(useMathHoverStore.getState().hover).toBeNull();
  });

  it("leaves live decorations alone when nothing changed", () => {
    const { term, decorations, live } = makeTerm(["so $x^2$ then"]);
    const math = run(term);
    const first = live()[0];
    math.scheduleScan();
    vi.advanceTimersByTime(500);
    // A rebuild here would tear the element out from under the pointer.
    expect(decorations).toHaveLength(1);
    expect(first.disposed).toBe(false);
  });

  it("hides a stranded hover popover when decorations are dropped", () => {
    const { term, live } = makeTerm(["so $x^2$ then"]);
    const math = run(term);
    live()[0].el.dispatchEvent(new MouseEvent("mouseenter"));
    expect(useMathHoverStore.getState().hover).not.toBeNull();
    math.clearDecorations();
    expect(useMathHoverStore.getState().hover).toBeNull();
  });

  it("skips the alternate buffer", () => {
    const { term, decorations } = makeTerm(["$$x^2$$"], { alternate: true });
    run(term);
    expect(decorations).toHaveLength(0);
  });

  it("places nothing while inline math is off", () => {
    useSettingsStore.setState({ mathInline: false });
    const { term, decorations } = makeTerm(["so $x^2$ then"]);
    run(term);
    expect(decorations).toHaveLength(0);
  });

  it("rescans on scroll and on leaving the alternate buffer", () => {
    const { term, handlers } = makeTerm(["so $x^2$ then"]);
    installMathAwareness(term, { isActive: () => true });
    expect(handlers.scroll).toBeTypeOf("function");
    expect(handlers.buffer).toBeTypeOf("function");
    expect(handlers.resize).toBeTypeOf("function");
  });

  it("keeps the newest formulas when over the decoration cap", () => {
    const rows = Array.from({ length: 120 }, (_, i) => `row $x_{${i}}$`);
    const { term, live } = makeTerm(rows, { viewportY: 96 });
    run(term);
    expect(live()).toHaveLength(80);
    expect(live()[live().length - 1].line).toBe(119);
  });
});

describe("installMathAwareness auto-follow", () => {
  it("pushes the newest formula's paragraph into the panel", () => {
    const { term } = makeTerm(["intro", "", "$$c^T x$$", "where $x$ decides"]);
    run(term);
    expect(useMathStore.getState().source).toBe("$$c^T x$$\nwhere $x$ decides");
    expect(useMathStore.getState().origin).toBe("auto");
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

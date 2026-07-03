import { useRef, useState } from "react";
import Terminal from "../Terminal/Terminal";
import {
  usePtyStore,
  type LeafPane,
  type PaneNode,
  type SplitPane,
  type PtyTab,
} from "../../stores/ptyStore";

/**
 * Renders a tab's pane tree. The tree is flattened into percentage rects and
 * every terminal renders as a keyed absolute cell under ONE parent — this is
 * load-bearing: with nested recursive rendering a split would change existing
 * terminals' positions in the React tree and remount them, killing their PTY
 * sessions and scrollback. Flat keyed siblings survive splits untouched, and
 * rect transitions give smooth split/close/resize motion for free.
 */

interface Frac {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LeafCell {
  leaf: LeafPane;
  rect: Frac;
}

interface DividerCell {
  split: SplitPane;
  region: Frac;
  /** Fractional x (row) or y (col) of the divider line. */
  boundary: number;
}

function layout(
  node: PaneNode,
  rect: Frac,
  leaves: LeafCell[],
  dividers: DividerCell[],
) {
  if (node.type === "leaf") {
    leaves.push({ leaf: node, rect });
    return;
  }
  if (node.dir === "row") {
    const aw = rect.w * node.ratio;
    layout(node.a, { x: rect.x, y: rect.y, w: aw, h: rect.h }, leaves, dividers);
    layout(
      node.b,
      { x: rect.x + aw, y: rect.y, w: rect.w - aw, h: rect.h },
      leaves,
      dividers,
    );
    dividers.push({ split: node, region: rect, boundary: rect.x + aw });
  } else {
    const ah = rect.h * node.ratio;
    layout(node.a, { x: rect.x, y: rect.y, w: rect.w, h: ah }, leaves, dividers);
    layout(
      node.b,
      { x: rect.x, y: rect.y + ah, w: rect.w, h: rect.h - ah },
      leaves,
      dividers,
    );
    dividers.push({ split: node, region: rect, boundary: rect.y + ah });
  }
}

const pct = (f: number) => `${f * 100}%`;

export default function PaneTree({
  tab,
  tabActive,
}: {
  tab: PtyTab;
  tabActive: boolean;
}) {
  const setActivePane = usePtyStore((s) => s.setActivePane);
  const setSplitRatio = usePtyStore((s) => s.setSplitRatio);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Rect transitions fight the pointer during a divider drag; pause them.
  const [resizing, setResizing] = useState(false);

  const leaves: LeafCell[] = [];
  const dividers: DividerCell[] = [];
  layout(tab.root, { x: 0, y: 0, w: 1, h: 1 }, leaves, dividers);
  const multi = leaves.length > 1;
  const zoomedId = tab.zoomedPaneId;
  // Bordered cards + gaps only make sense in actual split view; a zoomed
  // pane should look exactly like a normal single-pane tab.
  const showChrome = multi && !zoomedId;

  const startDividerDrag = (
    e: React.PointerEvent<HTMLDivElement>,
    d: DividerCell,
  ) => {
    e.preventDefault();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const wrapRect = wrap.getBoundingClientRect();
    const isRow = d.split.dir === "row";
    const originPx = isRow
      ? wrapRect.left + d.region.x * wrapRect.width
      : wrapRect.top + d.region.y * wrapRect.height;
    const spanPx = Math.max(
      1,
      isRow ? d.region.w * wrapRect.width : d.region.h * wrapRect.height,
    );
    setResizing(true);
    const onMove = (me: PointerEvent) => {
      const pos = isRow ? me.clientX : me.clientY;
      setSplitRatio(tab.id, d.split.id, (pos - originPx) / spanPx);
    };
    const onUp = () => {
      setResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    document.body.style.cursor = isRow ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div className={`h-full w-full ${showChrome ? "p-1.5" : ""}`}>
      <div ref={wrapRef} className="relative h-full w-full">
        {leaves.map(({ leaf, rect }) => {
          const isActivePane = leaf.id === tab.activePaneId;
          const isZoomed = zoomedId === leaf.id;
          const hiddenByZoom = zoomedId != null && !isZoomed;
          const effectiveRect = isZoomed ? { x: 0, y: 0, w: 1, h: 1 } : rect;
          return (
            <div
              key={leaf.id}
              className={
                hiddenByZoom
                  ? "hidden"
                  : resizing
                    ? "absolute"
                    : "absolute transition-[left,top,width,height] duration-150 ease-out"
              }
              style={{
                left: pct(effectiveRect.x),
                top: pct(effectiveRect.y),
                width: pct(effectiveRect.w),
                height: pct(effectiveRect.h),
                padding: showChrome ? 3 : 0,
              }}
            >
              <div
                data-pane-id={leaf.id}
                className={
                  showChrome
                    ? `relative h-full w-full overflow-hidden rounded-lg border transition-[border-color,opacity] duration-150 ${
                        isActivePane
                          ? "border-accent/45"
                          : "border-edge opacity-[0.88] hover:opacity-100"
                      }`
                    : "relative h-full w-full"
                }
                onMouseDownCapture={() => {
                  if (!isActivePane) setActivePane(tab.id, leaf.id);
                }}
              >
                <Terminal
                  tabId={tab.id}
                  paneId={leaf.id}
                  active={tabActive && isActivePane}
                  initialCwd={leaf.initialCwd}
                />
                {multi && !isActivePane && leaf.unread && (
                  <span
                    className="pointer-events-none absolute top-2 left-2 z-10 w-1.5 h-1.5 rounded-full bg-ink/80 animate-[dot-glow_1.8s_ease-in-out_infinite]"
                    title="New output in this pane"
                  />
                )}
                {isZoomed && (
                  <button
                    className="absolute top-2 right-2 z-10 flex items-center gap-1.5 h-6 px-2.5 rounded-full border border-accent/40 bg-raise/90 backdrop-blur-md text-[10px] text-accent shadow-[0_2px_12px_rgba(0,0,0,0.35)] hover:bg-accent hover:text-white transition-colors animate-[pop-in_0.12s_ease-out]"
                    onClick={() => usePtyStore.getState().toggleZoom()}
                    title="Restore split view (⌘⇧Z)"
                  >
                    <ZoomRestoreIcon />
                    Zoomed
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {!zoomedId &&
          dividers.map((d) => {
            const isRow = d.split.dir === "row";
            return (
              <div
                key={d.split.id}
                className={`group absolute z-10 grid place-items-center ${
                  isRow ? "w-2 cursor-col-resize" : "h-2 cursor-row-resize"
                }`}
                style={
                  isRow
                    ? {
                        left: pct(d.boundary),
                        top: pct(d.region.y),
                        height: pct(d.region.h),
                        transform: "translateX(-50%)",
                      }
                    : {
                        top: pct(d.boundary),
                        left: pct(d.region.x),
                        width: pct(d.region.w),
                        transform: "translateY(-50%)",
                      }
                }
                onPointerDown={(e) => startDividerDrag(e, d)}
                title="Drag to resize"
              >
                <div
                  className={`rounded-full bg-edge transition-colors group-hover:bg-accent/70 ${
                    isRow ? "h-[calc(100%-12px)] w-px" : "h-px w-[calc(100%-12px)]"
                  }`}
                />
              </div>
            );
          })}
      </div>
    </div>
  );
}

function ZoomRestoreIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.5 6.5h3v-3M6.5 9.5h-3v3M12.5 3.5 9.5 6.5M3.5 12.5l3-3" />
    </svg>
  );
}

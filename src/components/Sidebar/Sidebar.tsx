import type { ReactNode } from "react";
import { useUiStore } from "../../stores/uiStore";
import { useDragResize } from "../../lib/useDragResize";
import { useT } from "../../i18n";

/**
 * A collapsible side panel and its drag handle.
 *
 * Collapsing animates width, opacity and border together while the inner
 * wrapper keeps its full width — otherwise the contents would reflow through
 * every intermediate width on the way closed.
 */
export function Sidebar({
  side,
  open,
  width,
  children,
}: {
  side: "left" | "right";
  open: boolean;
  width: number;
  children: ReactNode;
}) {
  return (
    <aside
      className="shrink-0 overflow-hidden border-edge bg-panel/60 backdrop-blur-sm transition-[width,opacity,border-width] duration-200 ease-out"
      style={{
        width: open ? width : 0,
        [side === "left" ? "borderRightWidth" : "borderLeftWidth"]: open ? 1 : 0,
        opacity: open ? 1 : 0,
      }}
      aria-hidden={!open}
    >
      <div
        className="h-full transition-opacity duration-150 ease-out"
        style={{ width, opacity: open ? 1 : 0 }}
      >
        {children}
      </div>
    </aside>
  );
}

/** The 1px seam between a sidebar and the terminal area; drag to resize. */
export function ResizeHandle({
  side,
  active,
}: {
  side: "left" | "right";
  active: boolean;
}) {
  const t = useT();
  const setLeftSidebarWidth = useUiStore((s) => s.setLeftSidebarWidth);
  const setRightSidebarWidth = useUiStore((s) => s.setRightSidebarWidth);

  const startDrag = useDragResize("x", (x) => {
    if (side === "left") setLeftSidebarWidth(x);
    else setRightSidebarWidth(window.innerWidth - x);
  });

  return (
    <div
      className={`group relative z-10 shrink-0 bg-transparent transition-[width,opacity] duration-200 ease-out ${
        active ? "w-1 cursor-col-resize opacity-100" : "w-0 opacity-0"
      }`}
      onMouseDown={active ? startDrag : undefined}
      title={t("Resize sidebar")}
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-edge transition-colors group-hover:bg-accent/70" />
    </div>
  );
}

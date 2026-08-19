import { useEffect, type ReactNode } from "react";
import { useUiStore } from "../../stores/uiStore";
import { useDragResize } from "../../lib/useDragResize";
import { useT } from "../../i18n";

/**
 * The window's one collapsible side panel, and its drag handle.
 *
 * Collapsing animates width, opacity and border together while the inner
 * wrapper keeps its full width — otherwise the contents would reflow through
 * every intermediate width on the way closed. Children stay mounted at zero
 * width: a collapsed panel is hidden, not torn down.
 *
 * That width transition is dropped for the duration of a drag. It exists for
 * the one 200ms collapse; applied to the stream of widths a drag produces it
 * eases after the cursor instead of tracking it, and the panel edge visibly
 * trails the contents, which are sized directly.
 */
export function Sidebar({
  open,
  width,
  children,
}: {
  open: boolean;
  width: number;
  children: ReactNode;
}) {
  const resizing = useUiStore((s) => s.sidebarResizing);
  return (
    <aside
      className={`shrink-0 overflow-hidden border-edge bg-panel/60 backdrop-blur-sm ${
        resizing
          ? ""
          : "transition-[width,opacity,border-width] duration-200 ease-out"
      }`}
      style={{
        width: open ? width : 0,
        borderRightWidth: open ? 1 : 0,
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

/** The 1px seam between the sidebar and the terminal area; drag to resize. */
export function ResizeHandle({ active }: { active: boolean }) {
  const t = useT();
  const setSidebarWidth = useUiStore((s) => s.setSidebarWidth);
  const resizing = useUiStore((s) => s.sidebarResizing);
  const setResizing = useUiStore((s) => s.setSidebarResizing);
  const startDrag = useDragResize("x", setSidebarWidth);

  // The drag ends on a window-level mouseup rather than through the resize
  // hook, so releasing outside the 1px seam — which is most releases — still
  // puts the transition back.
  useEffect(() => {
    if (!resizing) return;
    const done = () => setResizing(false);
    window.addEventListener("mouseup", done);
    return () => window.removeEventListener("mouseup", done);
  }, [resizing, setResizing]);

  return (
    <div
      className={`group relative z-10 shrink-0 bg-transparent transition-[width,opacity] duration-200 ease-out ${
        active ? "w-1 cursor-col-resize opacity-100" : "w-0 opacity-0"
      }`}
      onMouseDown={
        active
          ? (e) => {
              setResizing(true);
              startDrag(e);
            }
          : undefined
      }
      title={t("Resize sidebar")}
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-edge transition-colors group-hover:bg-accent/70" />
    </div>
  );
}

import { useCallback } from "react";

/**
 * Pointer-driven resizing for the sidebar edges and the review panel's
 * divider.
 *
 * Two details are easy to get wrong and are therefore handled here once: the
 * body cursor/user-select overrides must be restored on *every* exit path
 * (otherwise a released drag leaves the whole app un-selectable), and the
 * handler reports the pointer's absolute position rather than a delta — so
 * hitting a clamp never leaves the divider drifting behind the cursor.
 */
export function useDragResize(
  axis: "x" | "y",
  onMove: (position: number) => void,
) {
  return useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const move = (ev: MouseEvent) =>
        onMove(axis === "x" ? ev.clientX : ev.clientY);
      const up = () => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [axis, onMove],
  );
}

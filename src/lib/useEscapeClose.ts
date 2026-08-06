import { useEffect, useRef } from "react";

/**
 * Close-on-Escape for the app's overlays (settings, palette, dashboard,
 * worktree modal, file finder).
 *
 * Registered in the **capture** phase on purpose: the focused xterm textarea
 * sits below and would otherwise swallow the key before it reached us. The
 * event is also stopped there, so an overlay stacked over another one closes
 * only itself.
 */
export function useEscapeClose(open: boolean, close: () => void) {
  // Through a ref so callers can pass an inline arrow without re-registering
  // the listener on every render.
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);
}

import { getFocusedTerminalTarget } from "./workspace";
import { useEffect, useRef } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { invoke } from "@tauri-apps/api/core";
import { usePtyStore, collectLeaves } from "../stores/ptyStore";
import { shellEscapePaths } from "./shellEscape";
import { attachReviewPaths } from "./reviewAttachments";
import { sendTermCmd } from "./termBus";
import { matchBinding } from "./keymap";
import { APP_BINDINGS } from "../appBindings";

/**
 * Window-level side effects the app shell owns. They live here rather than in
 * App.tsx so that file stays a description of the layout — each hook is a
 * self-contained subscription with its own teardown.
 */

/** Window-wide shortcuts; per-terminal ones live in Terminal.tsx. */
export function useGlobalKeymap() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const binding = matchBinding(APP_BINDINGS, e);
      if (!binding) return;
      e.preventDefault();
      binding.run(e);
      if (binding.refocus) requestAnimationFrame(() => sendTermCmd("focus"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/**
 * Files dropped on the window: plain drop attaches them to the review panel,
 * ⇧-drop inserts their escaped paths into the focused terminal instead.
 */
export function useWindowFileDrop() {
  // Tauri's drag-drop payload carries no modifier state, so shift is tracked
  // separately and read at drop time.
  const shiftDown = useRef(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") shiftDown.current = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") shiftDown.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      unlisten = await getCurrentWebview().onDragDropEvent(async (event) => {
        const { setDropPaths } = usePtyStore.getState();
        const sid = getFocusedTerminalTarget()?.sessionId;
        const p = event.payload;
        if (p.type === "enter" || p.type === "over") {
          if ("paths" in p && p.paths && p.paths.length > 0) {
            setDropPaths(p.paths);
          }
        } else if (p.type === "leave") {
          setDropPaths(null);
        } else if (p.type === "drop") {
          setDropPaths(null);
          const paths = ("paths" in p && p.paths) || [];
          if (paths.length === 0) return;
          if (shiftDown.current) {
            if (!sid) return;
            const escaped = await shellEscapePaths(paths);
            if (getFocusedTerminalTarget()?.sessionId !== sid) return;
            invoke("pty_write", { sessionId: sid, data: escaped.join(" ") + " " });
            return;
          }
          attachReviewPaths(paths).catch((err) =>
            console.error("attachReviewPaths failed", err),
          );
        }
      });
    })();
    return () => {
      unlisten?.();
    };
  }, []);
}

/**
 * Page teardown (dev HMR hard reload, window close) skips React effect
 * cleanup, which would orphan every backend PTY session until app quit —
 * best-effort kill them synchronously-ish on the way out. In the shipped app
 * window close also quits the process, so this is dev-mode hygiene.
 */
export function usePtyTeardownOnUnload() {
  useEffect(() => {
    const killAll = () => {
      for (const tab of usePtyStore.getState().tabs) {
        for (const leaf of collectLeaves(tab.root)) {
          if (leaf.sessionId && !leaf.exited) {
            invoke("pty_kill", { sessionId: leaf.sessionId }).catch(() => {});
          }
        }
      }
    };
    window.addEventListener("beforeunload", killAll);
    return () => window.removeEventListener("beforeunload", killAll);
  }, []);
}

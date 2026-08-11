import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Selection state for the ↑/↓/↩ lists (command palette, file finder, agent
 * dashboard). Three copies of this wrap-around arithmetic had drifted apart;
 * the one that matters is `Math.max(count, 1)`, without which an empty list
 * divides by zero and the index goes NaN.
 *
 * `selectedRef` goes on the selected row so it can be kept in view — see
 * [`OverlayRow`](../components/Overlay/Overlay.tsx).
 */
export function useListSelection(
  count: number,
  onActivate: (index: number) => void,
) {
  const [selected, setSelected] = useState(0);
  const selectedRef = useRef<HTMLDivElement>(null);

  // `handleKey` is stable so callers can put it in an effect's dependency
  // list (the dashboard registers a window-level listener with it) without
  // re-subscribing on every render. The live values reach it through refs.
  const activateRef = useRef(onActivate);
  const countRef = useRef(count);
  const selectedValue = useRef(selected);
  activateRef.current = onActivate;
  countRef.current = count;
  selectedValue.current = selected;

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected, count]);

  /** Returns true when the key was consumed, so callers can preventDefault. */
  const handleKey = useCallback(
    (e: KeyboardEvent | React.KeyboardEvent): boolean => {
      const wrap = Math.max(countRef.current, 1);
      if (e.key === "ArrowDown") {
        setSelected((s) => (s + 1) % wrap);
        return true;
      }
      if (e.key === "ArrowUp") {
        setSelected((s) => (s - 1 + wrap) % wrap);
        return true;
      }
      if (e.key === "Enter") {
        // Read through a ref rather than a state updater — an updater can be
        // invoked twice under StrictMode, which would run the action twice.
        activateRef.current(selectedValue.current);
        return true;
      }
      return false;
    },
    [],
  );

  return { selected, setSelected, selectedRef, handleKey };
}

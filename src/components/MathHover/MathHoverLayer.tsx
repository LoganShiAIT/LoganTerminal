import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMathHoverStore } from "../../stores/mathStore";

const GAP = 8;
const MARGIN = 12;

/**
 * Floating preview of a formula underlined in the terminal.
 *
 * Portaled to `document.body` on purpose: the sidebars use `backdrop-filter`,
 * which makes them a containing block for `position: fixed` children — a
 * lesson already paid for once by the asset lightbox.
 */
export default function MathHoverLayer() {
  const hover = useMathHoverStore((s) => s.hover);
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Measure after render: the popover is sized by its content, so placement
  // (above vs below, clamped horizontally) can only be decided once.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!hover || !box) {
      setPos(null);
      return;
    }
    const rect = box.getBoundingClientRect();
    const anchor = hover.anchor;
    const above = anchor.top - rect.height - GAP;
    const top = above >= MARGIN ? above : anchor.bottom + GAP;
    const centered = anchor.left + (anchor.right - anchor.left) / 2 - rect.width / 2;
    const left = Math.max(
      MARGIN,
      Math.min(centered, window.innerWidth - rect.width - MARGIN),
    );
    setPos({ left, top });
  }, [hover]);

  if (!hover) return null;

  return createPortal(
    <div
      ref={boxRef}
      className="pointer-events-none fixed z-[60] max-w-[70vw] rounded-xl border border-edge bg-raise/95 px-3 py-2 shadow-[0_16px_48px_rgba(0,0,0,0.5)] backdrop-blur-xl animate-[pop-in_0.1s_ease-out]"
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      <div
        className="md-body overflow-x-auto"
        dangerouslySetInnerHTML={{ __html: hover.html }}
      />
    </div>,
    document.body,
  );
}

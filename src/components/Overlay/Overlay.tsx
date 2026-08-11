/**
 * The shared chrome behind every full-screen overlay — command palette, file
 * finder, agent dashboard, worktree modal, settings.
 *
 * They all want the same thing: a dimmed backdrop that closes on an outside
 * click, a floating card, and (for the list-shaped ones) a header, a scrolling
 * body of selectable rows, and a hint footer. Keeping that in one place is
 * what stops five copies of the same class string from drifting apart.
 */
import type { ReactNode, RefObject } from "react";

interface OverlayProps {
  /** Card width in px; it still shrinks on narrow windows. */
  width: number;
  /**
   * "top" floats the card below the header — right for pickers you type into,
   * which should sit under your eyeline. "center" is for dialogs you read.
   */
  align?: "top" | "center";
  onClose: () => void;
  children: ReactNode;
}

export function Overlay({
  width,
  align = "top",
  onClose,
  children,
}: OverlayProps) {
  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center backdrop-blur-[2px] animate-[fade-in_0.1s_ease-out] ${
        align === "top"
          ? "items-start pt-[11vh] bg-black/35"
          : "items-center bg-black/45"
      }`}
      // mousedown, not click: a drag that starts inside the card and ends on
      // the backdrop (text selection) must not close it.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        // A centered dialog scrolls its own body, so it must not also clip it
        // — the two overflow rules are mutually exclusive, never both.
        className={`max-w-[92vw] rounded-2xl border border-edge bg-raise/95 backdrop-blur-xl shadow-[0_24px_80px_rgba(0,0,0,0.55)] animate-[pop-in_0.14s_ease-out] ${
          align === "center" ? "max-h-[82vh] overflow-y-auto" : "overflow-hidden"
        }`}
        style={{ width }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Title row: a label, optional context, and the `esc` affordance — or, when
 * `children` are given, a taller row holding whatever the overlay leads with
 * (the palette and finder lead with their input).
 */
export function OverlayHeader({
  title,
  note,
  children,
}: {
  title?: string;
  /** Small monospace context beside the title (repo name, counts, …). */
  note?: ReactNode;
  /** Replaces the title row entirely — for headers built around an input. */
  children?: ReactNode;
}) {
  if (children) {
    return (
      <div className="flex h-12 items-center gap-2.5 border-b border-edge px-4">
        {children}
      </div>
    );
  }
  return (
    <div className="flex h-11 items-center gap-2.5 border-b border-edge px-4">
      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
        {title}
      </span>
      {note && <span className="font-mono text-[10px] text-faint">{note}</span>}
      <span className="ml-auto kbd shrink-0">esc</span>
    </div>
  );
}

/** Scrolling result area. `max` is the viewport share it may occupy. */
export function OverlayList({
  max = "46vh",
  children,
}: {
  max?: string;
  children: ReactNode;
}) {
  return (
    <div className="overflow-y-auto py-1.5" style={{ maxHeight: max }}>
      {children}
    </div>
  );
}

/** Keyboard-and-mouse selectable row, with the accent bar on the selection. */
export function OverlayRow({
  selected,
  onSelect,
  onActivate,
  rowRef,
  title,
  compact,
  children,
}: {
  selected: boolean;
  /** Hover moves the selection, so the keyboard and mouse never disagree. */
  onSelect: () => void;
  onActivate: () => void;
  rowRef?: RefObject<HTMLDivElement | null>;
  title?: string;
  /** Slightly smaller type, for rows that carry several chips. */
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      ref={selected ? rowRef : undefined}
      title={title}
      className={`group relative mx-1.5 flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 transition-colors duration-75 ${
        compact ? "text-[12px]" : "text-[13px]"
      } ${
        selected
          ? "bg-accent/[0.13] text-ink"
          : "text-ink/75 hover:bg-ink/[0.05]"
      }`}
      onMouseMove={onSelect}
      onClick={onActivate}
    >
      {selected && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-full bg-accent" />
      )}
      {children}
    </div>
  );
}

/** Bottom hint bar. Pass `<OverlayHint>` children plus anything `ml-auto`. */
export function OverlayFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-8 items-center gap-3 border-t border-edge px-4 text-[10px] text-faint">
      {children}
    </div>
  );
}

/** One "⌘K does X" pair in an [`OverlayFooter`]. */
export function OverlayHint({ keys, label }: { keys: ReactNode; label: string }) {
  return (
    <span>
      <span className="text-muted">{keys}</span> {label}
    </span>
  );
}

/** Centered placeholder for an empty or failed result list. */
export function OverlayEmpty({
  children,
  tone = "faint",
}: {
  children: ReactNode;
  tone?: "faint" | "error";
}) {
  return (
    <div
      className={`px-4 py-6 text-center text-xs ${
        tone === "error" ? "break-all text-red-400/90" : "text-faint"
      }`}
    >
      {children}
    </div>
  );
}

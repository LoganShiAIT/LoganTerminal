/**
 * The app's icon set. Every glyph is drawn on the same 16×16 grid with
 * `currentColor` strokes, so an icon inherits the colour of whatever button
 * or chip it sits in and only ever needs `size` / `className` from a caller.
 *
 * Anything used in more than one place belongs here — several of these were
 * previously copy-pasted between panels and drifted apart in stroke width.
 */
import type { ReactNode } from "react";

interface GlyphProps {
  /** Rendered width and height in px. */
  size?: number;
  className?: string;
}

interface SvgProps extends GlyphProps {
  strokeWidth?: number;
  cap?: boolean;
  join?: boolean;
  children: ReactNode;
}

function Svg({
  size = 18,
  className,
  strokeWidth = 1.3,
  cap = true,
  join = true,
  children,
}: SvgProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap={cap ? "round" : undefined}
      strokeLinejoin={join ? "round" : undefined}
      aria-hidden
      className={className}
    >
      {children}
    </svg>
  );
}

export function FolderIcon({ size, className = "shrink-0 text-accent/80" }: GlyphProps) {
  return (
    <Svg size={size} className={className} cap={false}>
      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.9l1.4 1.7h4.7A1.5 1.5 0 0 1 14 6.2v5.3a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7Z" />
    </Svg>
  );
}

export function FileIcon({ size, className = "shrink-0 text-faint" }: GlyphProps) {
  return (
    <Svg size={size} className={className} cap={false}>
      <path d="M4 2.5h5L12.5 6v7a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-9.5a1 1 0 0 1 .5-1Z" />
      <path d="M9 2.5V6h3.5" />
    </Svg>
  );
}

export function SearchIcon({ size = 17, className = "shrink-0" }: GlyphProps) {
  return (
    <Svg size={size} className={className} strokeWidth={1.5} join={false}>
      <circle cx="7" cy="7" r="4.3" />
      <path d="m10.3 10.3 3.2 3.2" />
    </Svg>
  );
}

export function BranchIcon({ size = 14, className = "shrink-0" }: GlyphProps) {
  return (
    <Svg size={size} className={className} strokeWidth={1.5} join={false}>
      <circle cx="4.5" cy="3.5" r="1.8" />
      <circle cx="4.5" cy="12.5" r="1.8" />
      <circle cx="11.5" cy="5.5" r="1.8" />
      <path d="M4.5 5.3v5.4M11.5 7.3c0 2.2-3 2.4-5 3" />
    </Svg>
  );
}

export function RefreshIcon({ size = 17, className }: GlyphProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M13.5 1.8v2.7h-2.7" />
    </Svg>
  );
}

export function ChevronIcon({
  size = 16,
  className,
  dir = "down",
}: GlyphProps & { dir?: "up" | "down" }) {
  return (
    <Svg
      size={size}
      strokeWidth={1.8}
      className={`${dir === "up" ? "rotate-180" : ""} ${className ?? ""}`}
    >
      <path d="M3.5 6l4.5 4.5L12.5 6" />
    </Svg>
  );
}

export function ClockIcon({ size = 15, className = "shrink-0" }: GlyphProps) {
  return (
    <Svg size={size} className={className} strokeWidth={1.5}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 4.8V8l2.2 1.4" />
    </Svg>
  );
}

export function GearIcon({ size = 18, className }: GlyphProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2" />
    </Svg>
  );
}

/** Panel toggle: a framed area with the named edge highlighted. */
export function SidebarIcon({
  size = 19,
  className,
  side,
}: GlyphProps & { side: "left" | "right" }) {
  return (
    <Svg size={size} className={className} cap={false}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
      <path d={`M${side === "left" ? 3 : 10} 3v10`} />
    </Svg>
  );
}

export function EyeIcon({ size = 17, className, off }: GlyphProps & { off: boolean }) {
  return (
    <Svg size={size} className={className}>
      <path d="M1.8 8s2.2-4 6.2-4 6.2 4 6.2 4-2.2 4-6.2 4S1.8 8 1.8 8Z" />
      <circle cx="8" cy="8" r="1.7" />
      {off && <path d="M2.5 13.5 13.5 2.5" />}
    </Svg>
  );
}

export function TerminalPlusIcon({ size = 17, className }: GlyphProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M2 3.5h9a1 1 0 0 1 1 1v6" />
      <path d="M4.6 6.2 6.4 8l-1.8 1.8M7.6 10.2h2.2" />
      <path d="M2 3.5v8a1 1 0 0 0 1 1h4.2" />
      <path d="M11.6 11v4M9.6 13h4" />
    </Svg>
  );
}

export function SplitIcon({ size = 17, className }: GlyphProps) {
  return (
    <Svg size={size} className={className} cap={false}>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M8 3v10" />
    </Svg>
  );
}

export function ZoomRestoreIcon({ size = 15, className }: GlyphProps) {
  return (
    <Svg size={size} className={className} strokeWidth={1.5}>
      <path d="M9.5 6.5h3v-3M6.5 9.5h-3v3M12.5 3.5 9.5 6.5M3.5 12.5l3-3" />
    </Svg>
  );
}

export function CollapseIcon({
  size = 16,
  className,
  collapsed,
}: GlyphProps & { collapsed: boolean }) {
  return (
    <Svg size={size} className={className} strokeWidth={1.4}>
      <path d="M2.5 8h11" />
      {collapsed ? (
        <path d="M5.5 4.5 8 2l2.5 2.5M5.5 11.5 8 14l2.5-2.5" />
      ) : (
        <path d="M5.5 3.5 8 6l2.5-2.5M5.5 12.5 8 10l2.5 2.5" />
      )}
    </Svg>
  );
}

/** One-click agent launch: start something, right now. */
export function BoltIcon({ size = 18, className }: GlyphProps) {
  return (
    <Svg size={size} className={className} strokeWidth={1.3}>
      <path d="M8.8 1.8 3.6 9h3.6l-1 5.2L13.4 7H9.8l-1-5.2Z" />
    </Svg>
  );
}

/** An arrow heading into the side panel: "send this file to the reviewer". */
export function ToReviewIcon({ size = 16, className }: GlyphProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M9.8 2.8h2.7a1 1 0 0 1 1 1v8.4a1 1 0 0 1-1 1H9.8" />
      <path d="M2.5 8h6.2M6.4 5.6 8.8 8l-2.4 2.4" />
    </Svg>
  );
}

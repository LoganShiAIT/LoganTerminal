/**
 * The handful of controls every settings section is built from. Before this,
 * each section carried its own copy of these class strings and they had
 * quietly drifted (three different "selected chip" borders).
 */
import type { ReactNode } from "react";

export const FIELD =
  "w-full rounded-lg border border-edge bg-ink/[0.04] px-2.5 py-1.5 font-mono text-[13px] text-ink placeholder:text-faint focus:outline-none focus:border-accent/50";

export function Section({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="text-[12px] uppercase tracking-[0.18em] text-muted mb-2">
        {label}
      </div>
      {children}
    </div>
  );
}

/** One option in a mutually-exclusive row (language, cursor, speed). */
export function ChoiceButton({
  selected,
  onClick,
  title,
  mono,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  title?: string;
  /** Monospace + tighter, for numeric choices like the speed multipliers. */
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center gap-2 rounded-md border text-[13px] transition-colors ${
        mono ? "h-7 px-2.5 font-mono" : "h-8 px-3"
      } ${
        selected
          ? "border-accent text-accent bg-accent/10"
          : "border-edge text-muted hover:text-ink hover:border-accent/40"
      }`}
    >
      {children}
    </button>
  );
}

export function ToggleRow({
  checked,
  onToggle,
  label,
  title,
  disabled = false,
}: {
  checked: boolean;
  onToggle: () => void;
  label: ReactNode;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      className={`flex items-center gap-2.5 group ${
        disabled ? "opacity-30 pointer-events-none" : ""
      }`}
      onClick={onToggle}
      title={title}
      disabled={disabled}
    >
      <span
        className={`w-8 h-[18px] rounded-full p-[2px] transition-colors ${
          checked ? "bg-accent" : "bg-ink/15 group-hover:bg-ink/25"
        }`}
      >
        <span
          className={`block w-[14px] h-[14px] rounded-full bg-white/95 transition-transform ${
            checked ? "translate-x-[14px]" : ""
          }`}
        />
      </span>
      <span className="text-[14px] text-ink/85">{label}</span>
    </button>
  );
}

/** Small explanatory paragraph under a control. */
export function Hint({ children }: { children: ReactNode }) {
  return (
    <div className="text-[12px] leading-relaxed text-faint">{children}</div>
  );
}

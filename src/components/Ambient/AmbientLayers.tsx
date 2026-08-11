import { useSettingsStore } from "../../stores/settingsStore";

/**
 * Purely decorative layers, each behind its own setting and each a no-op
 * when off. Kept out of the layout components so App.tsx reads as structure.
 */

/** Drifting glow behind the whole window; respects reduced-motion in CSS. */
export function AmbientOrbs() {
  const ambient = useSettingsStore((s) => s.ambientMotion);
  if (!ambient) return null;
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden motion-reduce:hidden"
      aria-hidden
    >
      <div className="orb orb-a" />
      <div className="orb orb-b" />
      <div className="orb orb-c" />
    </div>
  );
}

/** Retro scanlines over the terminal area only. */
export function CrtOverlay() {
  const crt = useSettingsStore((s) => s.crtMode);
  if (!crt) return null;
  return <div className="crt-overlay" aria-hidden />;
}

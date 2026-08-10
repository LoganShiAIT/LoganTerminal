/** "870ms" / "4.2s" / "42s" / "1m 32s" / "1h 04m"-style compact duration. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalS = Math.round(ms / 1000);
  if (totalS < 60) return `${totalS}s`;
  const totalM = Math.floor(totalS / 60);
  const s = totalS % 60;
  if (totalM < 60) return s > 0 ? `${totalM}m ${s}s` : `${totalM}m`;
  const h = Math.floor(totalM / 60);
  const m = totalM % 60;
  return m > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${h}h`;
}

const AGO_UNITS: Array<[seconds: number, suffix: string]> = [
  [31_536_000, "y"],
  [2_592_000, "mo"],
  [604_800, "w"],
  [86_400, "d"],
  [3600, "h"],
  [60, "m"],
];

/**
 * Compact "how long ago" for a unix timestamp: `<1m` / `9m` / `5h` / `2d` /
 * `6w` / `4mo` / `2y`. Symbols rather than words so one string works in every
 * UI language — the exact date lives in the row's tooltip. A timestamp in the
 * future (clock skew, rebased dates) reads as `<1m` rather than a negative.
 */
export function formatAgo(unixSeconds: number, nowMs: number = Date.now()): string {
  const elapsed = Math.floor(nowMs / 1000) - unixSeconds;
  if (elapsed < 60) return "<1m";
  for (const [size, suffix] of AGO_UNITS) {
    if (elapsed >= size) return `${Math.floor(elapsed / size)}${suffix}`;
  }
  return "<1m";
}

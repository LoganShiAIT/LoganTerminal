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

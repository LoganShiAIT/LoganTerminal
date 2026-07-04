/**
 * Recently-run command-palette actions, persisted so the palette can float
 * what you actually use: a "Recent" group when the query is empty, and a
 * small score bump while searching.
 */
const KEY = "logan.paletteRecent";
const CAP = 10;

export function recentActionIds(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

export function recordAction(id: string) {
  const next = [id, ...recentActionIds().filter((x) => x !== id)].slice(
    0,
    CAP,
  );
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Best-effort — the palette works fine without persistence.
  }
}

/**
 * Search-mode bump: enough to break ties between comparable matches, well
 * below one word-start hit (+10 in fuzzy.ts) so relevance still wins.
 */
export function recencyBoost(id: string, recent: string[]): number {
  const rank = recent.indexOf(id);
  return rank === -1 ? 0 : Math.max(0, 6 - rank * 1.5);
}

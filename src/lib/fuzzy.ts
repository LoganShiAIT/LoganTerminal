export interface FuzzyResult {
  score: number;
  /** Indices into the target string that matched, for highlighting. */
  indices: number[];
}

const WORD_BOUNDARY = /[\s\-_/.:—·]/;

/**
 * Subsequence fuzzy match. Every query char (spaces ignored) must appear in
 * order in the target. Consecutive runs and word-starts score higher, and
 * shorter targets win ties, which is enough ranking for a command palette.
 */
export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  const q = query.replace(/\s+/g, "").toLowerCase();
  if (q.length === 0) return { score: 0, indices: [] };
  const t = target.toLowerCase();

  const indices: number[] = [];
  let score = 0;
  let ti = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const found = t.indexOf(q[qi], ti);
    if (found === -1) return null;
    if (found === 0 || WORD_BOUNDARY.test(target[found - 1])) {
      score += 10;
    } else if (indices.length > 0 && found === indices[indices.length - 1] + 1) {
      score += 8;
    } else {
      score += 1;
    }
    indices.push(found);
    ti = found + 1;
  }
  // Prefer earlier first-match and shorter targets as gentle tiebreakers.
  score -= indices[0] * 0.1 + target.length * 0.02;
  return { score, indices };
}

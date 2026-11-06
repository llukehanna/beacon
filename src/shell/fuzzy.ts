/** Fuzzy matching for the command palette. Pure: no DOM, no data layer. */

const WORD_START = 8;
const PREFIX = 3;
const CONTIGUOUS = 5;
const GAP = 1;
/** Per character of text; breaks ties toward the shorter, tighter name. */
const LENGTH = 0.01;

function isAlnum(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch);
}

/** True when the character at `i` begins a word: the first one, after a separator, or a camel hump. */
function startsWord(text: string, i: number): boolean {
  if (i === 0) {
    return true;
  }
  const prev = text.charAt(i - 1);
  const cur = text.charAt(i);
  if (!isAlnum(prev)) {
    return true;
  }
  return prev !== prev.toUpperCase() && cur !== cur.toLowerCase();
}

/**
 * Scores `query` against `text`: null when the query's letters do not appear in order, otherwise a
 * number where higher is better. Case and spaces in the query are ignored. A letter that begins a
 * word, a match at the very start and letters that sit next to each other all score extra, so
 * "bt" ranks "Bellhaven Talbot" above "Abbott Partners". An empty query matches everything at 0.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = Array.from(query.toLowerCase().replace(/\s+/g, ""));
  if (q.length === 0) {
    return 0;
  }
  const t = Array.from(text.toLowerCase());
  if (q.length > t.length) {
    return null;
  }
  // `best[j]` is the best score for the query so far with its latest letter on text position j.
  let best: number[] = t.map((ch, j) =>
    ch === q[0] ? 1 + (startsWord(text, j) ? WORD_START : 0) + (j === 0 ? PREFIX : 0) : -Infinity,
  );
  for (let i = 1; i < q.length; i += 1) {
    const next: number[] = new Array<number>(t.length).fill(-Infinity);
    // Highest earlier score that is not directly adjacent, for a jump over a gap.
    let gapBest = -Infinity;
    for (let j = 1; j < t.length; j += 1) {
      const before = best[j - 2];
      if (before !== undefined && before > gapBest) {
        gapBest = before;
      }
      if (t[j] !== q[i]) {
        continue;
      }
      const adjacent = (best[j - 1] ?? -Infinity) + CONTIGUOUS;
      const jumped = gapBest - GAP;
      const base = Math.max(adjacent, jumped);
      if (base > -Infinity) {
        next[j] = base + 1 + (startsWord(text, j) ? WORD_START : 0);
      }
    }
    best = next;
  }
  const top = Math.max(...best);
  return top === -Infinity ? null : top - t.length * LENGTH;
}

/**
 * The best `limit` matches for `query`, best first. Items with equal scores keep their original
 * order. An empty query returns the first `limit` items untouched.
 */
export function rankCommands<T extends { label: string }>(
  query: string,
  items: T[],
  limit = 8,
): T[] {
  if (query.trim() === "") {
    return items.slice(0, limit);
  }
  const scored: Array<{ item: T; score: number; index: number }> = [];
  items.forEach((item, index) => {
    const score = fuzzyScore(query, item.label);
    if (score !== null) {
      scored.push({ item, score, index });
    }
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, limit).map((s) => s.item);
}

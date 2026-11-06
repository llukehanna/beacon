const SKIPPED_WORDS = new Set(["the", "&", "and"]);

/** Initials for a firm tile: the first letters of its first two words, ignoring "the", "&" and "and". */
export function monogram(name: string): string {
  const words = name
    .split(/\s+/)
    .filter((word) => word !== "" && !SKIPPED_WORDS.has(word.toLowerCase()));
  if (words.length === 0) {
    return "";
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}

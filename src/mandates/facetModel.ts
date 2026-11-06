// Pure selection logic for the search page's facet pickers: a category cascades to its
// sub-options, sub-options toggle on their own, and anything typed that is not in the taxonomy is
// kept as a custom entry.
import type { FacetGroup } from "../../shared/taxonomy";

/** Index of `label` in `values`, ignoring case; -1 when absent. */
export function findIdx(values: readonly string[], label: string): number {
  const target = label.toLowerCase();
  return values.findIndex((v) => v.toLowerCase() === target);
}

export function hasValue(values: readonly string[], label: string): boolean {
  return findIdx(values, label) !== -1;
}

/** Adds the value, or removes it when it is already picked. */
export function toggleValue(values: readonly string[], label: string): string[] {
  const i = findIdx(values, label);
  if (i === -1) {
    return [...values, label];
  }
  return values.filter((_, at) => at !== i);
}

/**
 * Picks a category together with all of its sub-options, or drops it. On drop, a sub-option that
 * another picked category also owns stays ("Oil and Gas" sits under both Energy and
 * Infrastructure: deselecting Energy must not clear it while Infrastructure is picked).
 */
export function toggleCategory(
  values: readonly string[],
  group: FacetGroup,
  groups: readonly FacetGroup[],
): string[] {
  if (!hasValue(values, group.label)) {
    return [...values, ...[group.label, ...group.subs].filter((l) => !hasValue(values, l))];
  }
  return values.filter((v) => {
    const lower = v.toLowerCase();
    if (lower === group.label.toLowerCase()) {
      return false;
    }
    if (!group.subs.some((s) => s.toLowerCase() === lower)) {
      return true;
    }
    return groups.some(
      (other) =>
        other.label !== group.label &&
        hasValue(values, other.label) &&
        other.subs.some((s) => s.toLowerCase() === lower),
    );
  });
}

/** Picked values that are neither a category nor a sub-option of the taxonomy. */
export function customValues(values: readonly string[], groups: readonly FacetGroup[]): string[] {
  const preset = new Set<string>();
  for (const g of groups) {
    preset.add(g.label.toLowerCase());
    for (const sub of g.subs) {
      preset.add(sub.toLowerCase());
    }
  }
  return values.filter((v) => !preset.has(v.toLowerCase()));
}

/** Several pick lists as one, without blanks or case-insensitive repeats; first spelling wins. */
export function mergeValues(...lists: ReadonlyArray<readonly string[]>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of lists.flat()) {
    const key = v.trim().toLowerCase();
    if (key === "" || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(v);
  }
  return out;
}

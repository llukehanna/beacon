/** What the command palette can run: the command shape, the page registry and result grouping. */
import { useEffect, useSyncExternalStore } from "react";
import { fuzzyScore, rankCommands } from "./fuzzy";

export type CommandGroup = "Firms" | "Go to" | "Mandates" | "Actions";

export interface Command {
  id: string;
  label: string;
  group: CommandGroup;
  /** Quiet text after the label: a shortcut, a country. */
  hint?: string;
  run(): void;
}

export interface PaletteSection {
  group: CommandGroup;
  items: Command[];
}

/** Fixed order of the groups when nothing has been typed. */
const GROUP_ORDER: readonly CommandGroup[] = ["Actions", "Go to", "Mandates", "Firms"];

/** Results shown per group. */
const PER_GROUP = 8;

/**
 * The palette's result list. With no query it shows the short groups (actions, routes, mandates)
 * and leaves the firm list out, which is too long to browse. With a query each group keeps its best
 * matches and the group holding the best match comes first.
 */
export function paletteSections(query: string, commands: readonly Command[]): PaletteSection[] {
  const typed = query.trim() !== "";
  const sections: Array<PaletteSection & { top: number; order: number }> = [];
  GROUP_ORDER.forEach((group, order) => {
    if (!typed && group === "Firms") {
      return;
    }
    const inGroup = commands.filter((c) => c.group === group);
    const items = rankCommands(query, inGroup, PER_GROUP);
    const first = items[0];
    if (first === undefined) {
      return;
    }
    sections.push({ group, items, order, top: typed ? (fuzzyScore(query, first.label) ?? 0) : 0 });
  });
  sections.sort((a, b) => b.top - a.top || a.order - b.order);
  return sections.map(({ group, items }) => ({ group, items }));
}

// Pages register their own actions while mounted. A tiny external store keeps this free of
// providers: the palette subscribes, any screen calls `useCommands`.
let registered: Array<{ items: readonly Command[] }> = [];
let snapshot: readonly Command[] = [];
const listeners = new Set<() => void>();

function publish(): void {
  snapshot = registered.flatMap((r) => r.items);
  listeners.forEach((l) => l());
}

/** Adds commands until the returned function is called. */
export function registerCommands(items: readonly Command[]): () => void {
  const entry = { items };
  registered = [...registered, entry];
  publish();
  return () => {
    registered = registered.filter((r) => r !== entry);
    publish();
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Commands that screens have registered right now, in registration order. */
export function pageCommands(): readonly Command[] {
  return snapshot;
}

/** Subscribes to {@link pageCommands}. */
export function usePageCommands(): readonly Command[] {
  return useSyncExternalStore(subscribe, pageCommands, pageCommands);
}

/**
 * Registers a screen's own actions in the command palette while the screen is mounted. Memoize
 * `items` (useMemo) so the registration is not redone on every render.
 */
export function useCommands(items: readonly Command[]): void {
  useEffect(() => registerCommands(items), [items]);
}

import React from "react";
import {
  type Segment,
  navTarget,
  revealScrollTop,
  windowRange,
  windowSegments,
} from "@/desk/pipelineRows";
import type { Row } from "./pipelineModel";

const OVERSCAN = 6;

/**
 * Windowing and keyboard behaviour shared by the table and the card list. Only the rows in view
 * (plus overscan) are in the DOM, with spacers standing in for the rest, so every row must be
 * exactly `rowHeight` tall. The page's own scroll container (`scrollRef`) drives it. One row holds
 * the tab stop; arrow keys move focus, Enter or Space selects.
 *
 * Rows carry `data-index`; `listRef` goes on the element that holds them.
 */
export function useWindowedRows<E extends HTMLElement>({
  rows,
  selectedId,
  onSelect,
  scrollRef,
  rowHeight,
  headerHeight,
}: {
  rows: readonly Row[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  scrollRef: React.RefObject<HTMLElement>;
  rowHeight: number;
  /** Height of a sticky header that covers whatever scrolls under it; 0 when there is none. */
  headerHeight: number;
}) {
  const listRef = React.useRef<E>(null);
  const [range, setRange] = React.useState({ start: 0, end: 30 });
  const count = rows.length;
  // The active row is tracked by firm, not position, so re-sorting keeps it on the same firm.
  const [activeId, setActiveState] = React.useState<string | undefined>(undefined);
  // The logical active row. Key handling reads this, not the focused element, so a
  // key pressed before DOM focus has caught up with the last move still acts on the right row.
  const activeRef = React.useRef<string | undefined>(undefined);
  const setActiveId = React.useCallback((id: string | undefined) => {
    activeRef.current = id;
    setActiveState(id);
  }, []);
  // The row that holds DOM focus, if any. It stays rendered when it scrolls out of the window.
  const [focusedId, setFocusedId] = React.useState<string | undefined>(undefined);
  const focusPending = React.useRef(false);
  const indexById = React.useMemo(
    () => new Map(rows.map((r, i) => [r.firm.firmId ?? "", i] as const)),
    [rows],
  );
  const indexOf = (id: string | undefined): number =>
    Math.min(Math.max(0, indexById.get(id ?? "") ?? 0), count - 1);
  const activeIndex = indexOf(activeId);

  // How far the list's top edge has scrolled past the top of the scroll container.
  const listScrollTop = React.useCallback((): number => {
    const scroller = scrollRef.current;
    const list = listRef.current;
    if (scroller === null || list === null) {
      return 0;
    }
    return scroller.getBoundingClientRect().top - list.getBoundingClientRect().top;
  }, [scrollRef]);

  const measure = React.useCallback(() => {
    const scroller = scrollRef.current;
    if (scroller === null) {
      return;
    }
    const next = windowRange({
      scrollTop: listScrollTop(),
      viewportHeight: scroller.clientHeight,
      rowHeight,
      count,
      overscan: OVERSCAN,
    });
    setRange((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, [scrollRef, listScrollTop, rowHeight, count]);

  const reveal = React.useCallback(
    (index: number) => {
      const scroller = scrollRef.current;
      if (scroller === null) {
        return;
      }
      const current = listScrollTop();
      const target = revealScrollTop({
        scrollTop: current,
        viewportHeight: scroller.clientHeight,
        headerHeight,
        rowHeight,
        index,
      });
      if (target !== current) {
        scroller.scrollTop += target - current;
      }
    },
    [scrollRef, listScrollTop, headerHeight, rowHeight],
  );

  React.useLayoutEffect(() => {
    measure();
    const scroller = scrollRef.current;
    if (scroller === null) {
      return undefined;
    }
    scroller.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [measure, scrollRef]);

  // A newly selected row (keyboard, or a link in) is scrolled into view.
  const selectedIndex = React.useMemo(
    () => (selectedId === undefined ? -1 : rows.findIndex((r) => r.firm.firmId === selectedId)),
    [rows, selectedId],
  );
  const selectedIndexRef = React.useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;
  React.useEffect(() => {
    if (selectedIndexRef.current >= 0) {
      reveal(selectedIndexRef.current);
    }
  }, [selectedId, reveal]);

  // Keyboard focus follows the active row once it is in the DOM. Only while focus is still in
  // the list: if the user has moved on (clicked the search box), a stale move is dropped.
  React.useEffect(() => {
    if (!focusPending.current) {
      return;
    }
    const list = listRef.current;
    if (list === null || !list.contains(document.activeElement)) {
      focusPending.current = false;
      return;
    }
    const el = list.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    if (el) {
      focusPending.current = false;
      el.focus({ preventScroll: true });
    }
  });

  const moveTo = (next: number): void => {
    if (next === indexOf(activeRef.current)) {
      return;
    }
    focusPending.current = true;
    setActiveId(rows[next]?.firm.firmId ?? "");
    reveal(next);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) {
      return;
    }
    const index = indexOf(activeRef.current);
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 400) / rowHeight) - 2);
    const target = navTarget(e.key, index, count, page);
    if (target !== null) {
      moveTo(target);
    } else if (e.key === "Enter" || e.key === " ") {
      const id = rows[index]?.firm.firmId;
      if (id) {
        onSelect(id);
      }
    } else {
      return;
    }
    e.preventDefault();
  };

  const onFocus = (e: React.FocusEvent<HTMLElement>): void => {
    const index = Number((e.target as HTMLElement).dataset.index);
    if (Number.isInteger(index) && rows[index]) {
      const id = rows[index].firm.firmId ?? "";
      setActiveId(id);
      setFocusedId(id);
    }
  };

  const onBlur = (e: React.FocusEvent<HTMLElement>): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setFocusedId(undefined);
    }
  };

  /** A new order starts at the top of the list. */
  const scrollToTop = (): void => {
    const scroller = scrollRef.current;
    const above = listScrollTop();
    if (scroller !== null && above > 0) {
      scroller.scrollTop -= above;
    }
  };

  const start = Math.min(range.start, count);
  const end = Math.min(range.end, count);
  const focusedIndex = focusedId === undefined ? null : (indexById.get(focusedId) ?? null);
  const segments: Segment[] = windowSegments({ start, end, count, pinned: focusedIndex });
  // The tab stop is the active row when it is rendered, else the nearest rendered one, so
  // Tab can always reach the list.
  const activeRendered =
    (activeIndex >= start && activeIndex < end) || activeIndex === focusedIndex;
  const tabIndexRow = activeRendered
    ? activeIndex
    : Math.max(start, Math.min(end - 1, activeIndex));

  return { listRef, segments, tabIndexRow, onKeyDown, onFocus, onBlur, scrollToTop };
}

import React from "react";

/**
 * The queue's search text and "Show all firms" switch. They live in the Desk, above the portal
 * that puts the queue in the sidebar: the sidebar remounts its contents when the drawer opens or
 * closes and when the window crosses the narrow breakpoint, and these must survive that.
 */
export function useQueueFilters(): {
  query: string;
  setQuery: (q: string) => void;
  showAll: boolean;
  setShowAll: (on: boolean) => void;
} {
  const [query, setQuery] = React.useState("");
  const [showAll, setShowAll] = React.useState(false);
  return { query, setQuery, showAll, setShowAll };
}

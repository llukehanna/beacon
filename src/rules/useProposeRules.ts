import React from "react";
import { useOsdkAction } from "@/data/hooks";
import { clusterRejectionsAction } from "@/data/ontology";

export interface ProposeRules {
  /** Clusters the analysts' rejections into proposed screening rules. */
  run: () => void;
  isPending: boolean;
  /** What the last run reported. */
  note: string | null;
  error: string | undefined;
}

/** The learning loop on demand; shared by the Rules header button and the command palette. */
export function useProposeRules(): ProposeRules {
  const cluster = useOsdkAction(clusterRejectionsAction);
  const [note, setNote] = React.useState<string | null>(null);
  // The action hook returns fresh functions every render; `run` reads the latest through a ref so
  // it stays the same function and the palette registration is not redone on every render.
  const latest = React.useRef(cluster);
  latest.current = cluster;

  const run = React.useCallback((): void => {
    if (latest.current.isPending) {
      return;
    }
    setNote(null);
    latest.current
      .applyAction({})
      .then((r) => setNote(r.note ?? "Done."))
      .catch(() => undefined); // Surfaced through cluster.error.
  }, []);

  return { run, isPending: cluster.isPending, note, error: cluster.error?.message };
}

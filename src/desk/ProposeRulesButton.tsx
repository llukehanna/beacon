import React from "react";
import { useOsdkAction } from "@/data/hooks";
import { clusterRejectionsAction } from "@/data/ontology";

/** Runs the learning loop on demand (sits at the right end of the Rules header): cluster rejections into proposed screening rules. */
export function ProposeRulesButton(): React.ReactElement {
  const cluster = useOsdkAction(clusterRejectionsAction);
  const [note, setNote] = React.useState<string | null>(null);

  const onClick = (): void => {
    setNote(null);
    cluster
      .applyAction({})
      .then((r) => setNote(r.note ?? "Done."))
      .catch(() => undefined); // surfaced via cluster.error
  };

  return (
    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
      {note !== null && <span style={{ fontSize: 12, opacity: 0.8 }}>{note}</span>}
      {cluster.error !== undefined && (
        <span style={{ fontSize: 12, color: "#f7aaa3" }}>{cluster.error.message}</span>
      )}
      <button
        type="button"
        className="btn btn-secondary"
        onClick={onClick}
        disabled={cluster.isPending}
      >
        {cluster.isPending ? "Reading rejections…" : "Propose rules from rejections"}
      </button>
    </div>
  );
}

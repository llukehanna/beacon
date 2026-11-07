import React from "react";
import { errorMessage } from "@/data/adapter";
import { useFirmObservations } from "@/data/firmObservations";
import { useObservableClient, useOsdkAction, useOsdkObjects } from "@/data/hooks";
import { ResearchFinding, enrichFirmAction, verifyFindingAction } from "@/data/ontology";
import { MoreLikeThis } from "@/lookalikes/MoreLikeThis";
import { isTypingTarget } from "@/shell/keys";
import { useTourStepId } from "@/tour/tourContext";
import { ENRICH_AXES } from "../../../shared/vocab";
import { type FindingLike } from "../axisState";
import { HARD_GATE_PASS_WHEN, effectiveAxisValue, verifiedBaselineEdits } from "../findingActions";
import { type ActiveConfigRule } from "../queue";
import { mirrorScore } from "../scoreMirror";
import { AgentRunStrip } from "./AgentRunStrip";
import { AxisGrid } from "./AxisGrid";
import { DecisionBar } from "./DecisionBar";
import styles from "./EnrichmentPanel.module.css";
import { EvidenceDrawer, EvidencePanel } from "./EvidencePanel";
import { FirmHeader } from "./FirmHeader";
import { SpineAxes } from "./SpineAxes";
import { agentHasRun } from "./agentRun";
import { buildAxisRows, summarizeRows } from "./axisRows";
import {
  type EditMap,
  type FirmView,
  buildMerged,
  editorForEditKey,
  enrichParams,
  toScoreInput,
} from "./deskModel";
import { otherDialogOpen } from "./dialogs";
import { buildOnFile } from "./onFile";
import { projectProposals } from "./projection";
import { useMediaQuery } from "./useMediaQuery";

export function EnrichmentPanel({
  firm,
  allFirms,
  firmsLoading,
  activeConfigs,
  configsLoading,
}: {
  firm: FirmView;
  allFirms: FirmView[];
  firmsLoading: boolean;
  activeConfigs: readonly ActiveConfigRule[];
  configsLoading: boolean;
}): React.ReactElement {
  const [edits, setEdits] = React.useState<EditMap>({});
  // Verifications staged locally — findingId → true (plain verify) or the
  // override value string ("Keep mine"). Nothing reaches verifyFindingAction
  // until Commit enrichment: walking away from the desk discards these,
  // exactly like uncommitted axis edits. Commit is the one transaction
  // boundary for both the firm fields and the finding statuses.
  const [pendingVerify, setPendingVerify] = React.useState<Record<string, string | true>>({});
  const [flushError, setFlushError] = React.useState<string | null>(null);
  // The grid's selected axis (finding vocabulary), the source whose reading is open in the
  // evidence panel, and, under 1280 px, whether the evidence drawer is open.
  const [selectedAxis, setSelectedAxis] = React.useState<string | undefined>(undefined);
  const [provider, setProvider] = React.useState<string | undefined>(undefined);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const wide = useMediaQuery("(min-width: 1280px)");
  const enrich = useOsdkAction(enrichFirmAction);
  const verify = useOsdkAction(verifyFindingAction);
  const observable = useObservableClient();

  React.useEffect(() => {
    setEdits({});
    setPendingVerify({});
    setFlushError(null);
    setSelectedAxis(undefined);
    setProvider(undefined);
    setDrawerOpen(false);
    // A new firm opens at its header, not wherever the last one was scrolled to.
    scrollRef.current?.scrollTo({ top: 0 });
  }, [firm.firmId]);

  const base = React.useMemo(() => toScoreInput(firm), [firm]);
  const before = mirrorScore(base);
  const after = mirrorScore(buildMerged(base, edits));

  const setAxis = React.useCallback((key: string, value: string | number | boolean) => {
    setEdits((prev) => ({ ...prev, [key]: value }));
  }, []);

  const queueVerify = React.useCallback((f: FindingLike, overrideValue?: string): void => {
    const id = f.findingId;
    if (id === undefined || id === "") {
      return;
    }
    setPendingVerify((prev) => ({ ...prev, [id]: overrideValue ?? true }));
  }, []);

  const dirty = Object.keys(edits).length > 0 || Object.keys(pendingVerify).length > 0;

  // Findings query (shared by the grid, the evidence panel and the projected score).
  const firmId = firm.firmId ?? "";
  const { data: findingsData, isLoading: findingsLoading } = useOsdkObjects(ResearchFinding, {
    where: { firmId: { $eq: firmId } },
    autoFetchMore: true,
  });
  const findings = React.useMemo(() => findingsData ?? [], [findingsData]);
  // Staged verifications render as verified before they're committed — the
  // overlay is display state only; the server still says proposed.
  const overlaidFindings = React.useMemo(
    () =>
      findings.map((f) =>
        f.findingId !== undefined && f.findingId !== "" && pendingVerify[f.findingId] !== undefined
          ? { ...f, findingStatus: "verified", verifiedByHuman: true }
          : f,
      ),
    [findings, pendingVerify],
  );

  // The observations are what the providers would say; they are only what the agent saw once
  // it has run. Analyst entries are findings too, so "has run" is read from who wrote them,
  // never from the firm's enrichment stamp or the mere presence of findings.
  const agentRan = findingsLoading ? undefined : agentHasRun(findings);
  const observations = useFirmObservations(agentRan === true ? firm.firmId : undefined);
  const seen = agentRan === true ? observations.data : undefined;
  const rows = React.useMemo(
    () =>
      buildAxisRows(
        ENRICH_AXES.filter((a) => a.models.includes(after.model)),
        seen,
        overlaidFindings,
      ),
    [after.model, seen, overlaidFindings],
  );
  const counts = React.useMemo(() => summarizeRows(rows), [rows]);
  const onFile = React.useMemo(
    () => buildOnFile(rows, firm, edits, after),
    [rows, firm, edits, after],
  );
  const projection = React.useMemo(() => projectProposals(base, edits, rows), [base, edits, rows]);

  // The grid shows once the provider readings are in as well as the findings: until then a row
  // can be picked whose evidence has nothing to show yet, and the summary above the grid
  // reads as final while the cells under it are still empty.
  const gridLoading = findingsLoading || (agentRan === true && observations.isLoading);

  // Where the wide layout opens: the first axis that needs a decision, once per firm.
  const autoSelected = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    if (!wide || selectedAxis !== undefined || autoSelected.current === firm.firmId) {
      return;
    }
    const open = ["conflict", "proposed", "abstained"]
      .map((state) => rows.find((r) => r.state === state))
      .find((r) => r !== undefined);
    const first = open ?? rows.find((r) => r.state !== "empty");
    if (first !== undefined) {
      autoSelected.current = firm.firmId;
      // Never replaces a pick made since this effect was scheduled: it keeps what is there.
      setSelectedAxis((picked) => picked ?? first.axis);
    }
  }, [wide, selectedAxis, rows, firm.firmId]);

  const selectedRow = rows.find((r) => r.axis === selectedAxis);
  // The tour's "every value cites its source" stop points into the evidence panel. Under 1280 px
  // that panel is a drawer, so the stop opens it on the first conflict (a view change only) and
  // closes it when the tour moves on.
  const tourStepId = useTourStepId();
  const tourEvidence = tourStepId === "evidence";
  const tourOpenedDrawer = React.useRef(false);
  React.useEffect(() => {
    if (wide) {
      return;
    }
    if (tourEvidence && !tourOpenedDrawer.current) {
      const row = rows.find((r) => r.state === "conflict") ?? rows.find((r) => r.state !== "empty");
      if (row !== undefined) {
        tourOpenedDrawer.current = true;
        setSelectedAxis(row.axis);
        setProvider(undefined);
        setDrawerOpen(true);
      }
    } else if (!tourEvidence && tourOpenedDrawer.current) {
      tourOpenedDrawer.current = false;
      setDrawerOpen(false);
    }
  }, [wide, tourEvidence, rows]);

  const selectAxis = React.useCallback((axis: string, source?: string) => {
    setSelectedAxis(axis);
    setProvider(source);
    setDrawerOpen(true);
  }, []);

  const getCurrent = React.useCallback(
    (editKey: string) => effectiveAxisValue(firm, edits, editKey),
    [firm, edits],
  );

  // Re-stage values from findings verified by past commits. The edit map
  // resets on reload / firm switch — without this, a firm could read
  // "9 verified" beside blank axes, a stale preview score, and a Commit
  // button with nothing to send. Reads SERVER state only (never staged
  // verifications), and only fills axes that are unset — firm fields and
  // in-session edits win — so the effect converges: once staged,
  // verifiedBaselineEdits returns [].
  React.useEffect(() => {
    const staged = verifiedBaselineEdits(findings, (editKey) =>
      effectiveAxisValue(firm, edits, editKey),
    );
    if (staged.length === 0) {
      return;
    }
    setEdits((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const { editKey, value } of staged) {
        if (!Object.prototype.hasOwnProperty.call(next, editKey)) {
          next[editKey] = value;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [findings, firm, edits]);

  const findingObjById = React.useMemo(() => {
    const m = new Map<string, FindingLike>();
    for (const f of findings) {
      if (f.findingId !== undefined && f.findingId !== "") {
        m.set(f.findingId, f);
      }
    }
    return m;
  }, [findings]);

  const onCommit = React.useCallback(() => {
    const args = enrichParams(firmId, edits);
    void (async () => {
      try {
        await enrich.applyAction(args);
      } catch {
        // Surfaced via enrich.error; everything stays staged for retry.
        return;
      }
      // Field write landed — now flush staged verifications. Failures keep
      // their queue entry (and the dirty bit) so a retry re-flushes them.
      const failed: Record<string, string | true> = {};
      let firstError: unknown = null;
      for (const [findingId, ov] of Object.entries(pendingVerify)) {
        const obj = findingObjById.get(findingId);
        if (obj === undefined) {
          continue;
        }
        try {
          await verify.applyAction(
            ov === true
              ? { finding: obj.findingId }
              : { finding: obj.findingId, overrideValue: ov },
          );
        } catch (e) {
          failed[findingId] = ov;
          if (firstError === null) {
            firstError = e;
          }
        }
      }
      setEdits({});
      setPendingVerify(failed);
      setFlushError(firstError === null ? null : errorMessage(firstError));
      // The enrich function modifies the firm, but the action's edit
      // response doesn't reliably list it — refresh explicitly so the
      // committed fields land in the axis rows (and the staged-edit
      // hydration sees fresh firm state instead of racing a stale one).
      void observable.invalidateObjects();
    })();
  }, [firmId, edits, enrich, pendingVerify, findingObjById, verify, observable]);

  // Keyboard shortcuts. The arrow keys move the grid's selection; 0, 1, 2 and P, F answer the
  // selected axis; V and R act on a proposed value (see EvidenceBody).
  const rowsRef = React.useRef(rows);
  rowsRef.current = rows;
  const selectedRef = React.useRef(selectedAxis);
  selectedRef.current = selectedAxis;
  const afterModelRef = React.useRef(after.model);
  afterModelRef.current = after.model;
  const commitRef = React.useRef<() => void>(() => undefined);
  commitRef.current = onCommit;

  React.useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // A dialog (demo reset confirm, shortcuts) owns the keyboard while it is open.
      if (otherDialogOpen()) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        commitRef.current();
        e.preventDefault();
        return;
      }
      if (e.key === "Escape") {
        setSelectedAxis(undefined);
        setDrawerOpen(false);
        e.preventDefault();
        return;
      }
      if (isTypingTarget(e.target as Element | null) || e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }
      const list = rowsRef.current;
      const currentIdx = list.findIndex((r) => r.axis === selectedRef.current);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const step = e.key === "ArrowDown" ? 1 : -1;
        const next = list[Math.min(list.length - 1, Math.max(0, currentIdx + step))];
        if (next) {
          setSelectedAxis(next.axis);
          setProvider(undefined);
        }
        e.preventDefault();
        return;
      }
      const row = list[currentIdx];
      if (!row) {
        return;
      }
      const editKey = row.def.actionParam;
      if (row.def.kind === "gate") {
        if (e.key === "p" || e.key === "f") {
          // Pass/Fail is polarity-mapped per gate: the stored boolean flips for advisoryConflict
          // and hasStOrBalanceSheet, where true means "has a problem".
          const passWhen = HARD_GATE_PASS_WHEN[editKey] ?? true;
          setAxis(editKey, e.key === "p" ? passWhen : !passWhen);
          e.preventDefault();
        }
        return;
      }
      const ed = editorForEditKey(editKey, afterModelRef.current);
      if (ed?.kind === "categorical" && ed.options && ["0", "1", "2"].includes(e.key)) {
        const opt = ed.options.find((o) => o.score === Number(e.key));
        if (opt) {
          setAxis(ed.editKey, opt.label);
        }
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setAxis]);

  const evidence = {
    row: selectedRow,
    firm,
    allFirms,
    firmsLoading,
    model: after.model,
    edits,
    onFile,
    getCurrent,
    applyEdit: setAxis,
    queueVerify,
    provider,
    onProvider: setProvider,
  };

  return (
    <div className={styles.layout}>
      <div className={styles.column}>
        <div ref={scrollRef} className={styles.scroll}>
          <FirmHeader
            firm={firm}
            before={before}
            after={after}
            saving={enrich.isPending}
            projection={projection}
            activeConfigs={activeConfigs}
            configsLoading={configsLoading}
          />

          <AgentRunStrip firm={firm} firmId={firmId} agentRan={agentRan} />

          <AxisGrid
            rows={rows}
            counts={counts}
            edits={edits}
            onFile={onFile}
            selected={selectedAxis}
            onSelect={selectAxis}
            loading={gridLoading}
          />

          <SpineAxes firm={firm} mirror={after} />

          {firmId !== "" && <MoreLikeThis firmId={firmId} />}

          <DecisionBar
            firm={firm}
            firmId={firmId}
            mirror={after}
            edits={edits}
            onCommit={onCommit}
            dirty={dirty}
            enrichPending={enrich.isPending}
            enrichError={enrich.error ?? (flushError === null ? undefined : flushError)}
          />
        </div>
      </div>

      {wide ? (
        <EvidencePanel {...evidence} />
      ) : (
        <EvidenceDrawer
          {...evidence}
          isOpen={drawerOpen && selectedRow !== undefined}
          onClose={() => setDrawerOpen(false)}
          touring={tourStepId !== null}
        />
      )}
    </div>
  );
}

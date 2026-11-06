import React from "react";
import { useObservableClient, useOsdkAction, useOsdkObjects } from "@/data/hooks";
import { ResearchFinding, enrichFirmAction, verifyFindingAction } from "@/data/ontology";
import { isTypingTarget } from "@/shell/keys";
import { type FindingLike } from "../axisState";
import {
  FINDING_AXIS_TO_KEY,
  coerceFindingValue,
  effectiveAxisValue,
  verifiedBaselineEdits,
} from "../findingActions";
import { type ActiveConfigRule } from "../queue";
import { mirrorScore } from "../scoreMirror";
import { AxisBreakdown } from "./AxisBreakdown";
import { DecisionMemory } from "./DecisionMemory";
import { FirmHeader } from "./FirmHeader";
import { HardGates } from "./HardGates";
import { ConfirmChecklist, YourCallRail } from "./YourCallRail";
import {
  type EditMap,
  type FirmView,
  NUMERIC_KEYS,
  buildMerged,
  editorForAxis,
  toScoreInput,
} from "./deskModel";
import { FindingsSection } from "./findings/FindingsSection";
import { SourceExcerpts } from "./findings/SourceExcerpts";
import { HARD_GATES } from "./hardGateConfig";

export function EnrichmentPanel({
  firm,
  actionFirm,
  allFirms,
  firmsLoading,
  activeConfigs,
  configsLoading,
}: {
  firm: FirmView;
  actionFirm: unknown;
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
  const [focused, setFocused] = React.useState<string | undefined>(undefined);
  const [elapsed, setElapsed] = React.useState(0);
  const enrich = useOsdkAction(enrichFirmAction);
  const verify = useOsdkAction(verifyFindingAction);
  const observable = useObservableClient();

  React.useEffect(() => {
    setEdits({});
    setPendingVerify({});
    setFlushError(null);
    setFocused(undefined);
    setElapsed(0);
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, [firm.firmId]);

  const base = toScoreInput(firm);
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

  // Findings query (shared by axis breakdown + section + excerpts).
  const firmId = firm.firmId ?? "";
  const { data: findingsData } = useOsdkObjects(ResearchFinding, {
    where: { firmId: { $eq: firmId } },
    autoFetchMore: true,
  });
  const findings = React.useMemo(
    () => (findingsData ?? []) as unknown as FindingLike[],
    [findingsData],
  );
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

  const findingsByAxisKey = React.useMemo(() => {
    const m = new Map<string, FindingLike[]>();
    for (const f of overlaidFindings) {
      if ((f.findingStatus ?? "").toLowerCase() === "superseded") {
        continue;
      }
      const key = FINDING_AXIS_TO_KEY[f.axis ?? ""];
      if (key) {
        const arr = m.get(key) ?? [];
        arr.push(f);
        m.set(key, arr);
      }
    }
    return m;
  }, [overlaidFindings]);

  // Re-stage values from findings verified by past commits. The edit map
  // resets on reload / firm switch — without this, a firm could read
  // "9 verified" beside blank axes, a stale preview score, and a Commit
  // button with nothing to send. Reads SERVER state only (never staged
  // verifications), and only fills axes that are unset — firm fields and
  // in-session edits win — so the effect converges: once staged,
  // verifiedBaselineEdits returns [].
  React.useEffect(() => {
    const staged = verifiedBaselineEdits(findings, (editKey) =>
      effectiveAxisValue(firm as unknown as Record<string, unknown>, edits, editKey),
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
    const args: Record<string, unknown> = {
      firm: actionFirm,
      fieldsEnteredManually: JSON.stringify(Object.keys(edits)),
    };
    for (const [k, v] of Object.entries(edits)) {
      if (v === "" || v === undefined) {
        continue;
      }
      args[k] = NUMERIC_KEYS.includes(k) ? Number(v) : v;
    }
    void (async () => {
      try {
        await enrich.applyAction(args as never);
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
        const vArgs: Record<string, unknown> = { finding: obj };
        if (ov !== true) {
          vArgs.overrideValue = ov;
        }
        try {
          await verify.applyAction(vArgs as never);
        } catch (e) {
          failed[findingId] = ov;
          if (firstError === null) {
            firstError = e;
          }
        }
      }
      setEdits({});
      setPendingVerify(failed);
      setFlushError(firstError === null ? null : String(firstError));
      // The enrich function modifies the firm, but the action's edit
      // response doesn't reliably list it — refresh explicitly so the
      // committed fields land in the axis rows (and the staged-edit
      // hydration sees fresh firm state instead of racing a stale one).
      void observable.invalidateObjects(actionFirm as never);
    })();
  }, [actionFirm, edits, enrich, pendingVerify, findingObjById, verify, observable]);

  // Keyboard shortcuts.
  const focusEntries = React.useMemo(() => {
    const list: string[] = [];
    for (const a of after.axisScores) {
      if (editorForAxis(a.axis, after.model)) {
        list.push(`axis:${a.axis}`);
      }
    }
    for (const g of HARD_GATES) {
      list.push(`gate:${g.editKey}`);
    }
    return list;
  }, [after]);

  const focusRef = React.useRef(focused);
  focusRef.current = focused;
  const entriesRef = React.useRef(focusEntries);
  entriesRef.current = focusEntries;
  const commitRef = React.useRef<() => void>(() => undefined);
  commitRef.current = onCommit;

  React.useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // A popover dialog (demo reset confirm) owns the keyboard while it is open.
      if (document.querySelector('[role="dialog"]') !== null) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        commitRef.current();
        e.preventDefault();
        return;
      }
      if (e.key === "Escape") {
        setFocused(undefined);
        e.preventDefault();
        return;
      }
      if (isTypingTarget(e.target as Element | null)) {
        return;
      }
      const entries = entriesRef.current;
      const currentIdx = entries.findIndex((x) => x === focusRef.current);
      if (e.key === "ArrowDown") {
        const next = entries[Math.min(entries.length - 1, currentIdx + 1)];
        if (next) {
          setFocused(next);
        }
        e.preventDefault();
        return;
      }
      if (e.key === "ArrowUp") {
        const prev = entries[Math.max(0, currentIdx - 1)];
        if (prev) {
          setFocused(prev);
        }
        e.preventDefault();
        return;
      }
      const entry = entries[currentIdx];
      if (!entry) {
        return;
      }
      if (entry.startsWith("axis:")) {
        const axisLabel = entry.slice(5);
        const ed = editorForAxis(axisLabel, after.model);
        if (ed?.kind === "categorical" && ed.options && ["0", "1", "2"].includes(e.key)) {
          const opt = ed.options.find((o) => o.score === Number(e.key));
          if (opt) {
            setAxis(ed.editKey, opt.label);
          }
          e.preventDefault();
        }
      } else if (entry.startsWith("gate:") && (e.key === "p" || e.key === "f")) {
        // Pass/Fail is polarity-mapped per gate — the stored boolean flips
        // for advisoryConflict / hasStOrBalanceSheet where "true" means
        // "has-problem". Look up the gate's passWhen before writing.
        const gateKey = entry.slice(5);
        const gate = HARD_GATES.find((h) => h.editKey === gateKey);
        if (gate) {
          setAxis(gateKey, e.key === "p" ? gate.passWhen : !gate.passWhen);
        }
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [after.model, setAxis]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <main
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "20px 24px 28px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          minWidth: 0,
        }}
      >
        <FirmHeader
          firm={firm}
          before={before}
          after={after}
          elapsed={elapsed}
          saving={enrich.isPending}
          activeConfigs={activeConfigs}
          configsLoading={configsLoading}
        />

        <AxisBreakdown
          firm={firm}
          mirror={after}
          edits={edits}
          setAxis={setAxis}
          focused={focused}
          setFocused={setFocused}
          findingsByAxisKey={findingsByAxisKey}
        />

        <DecisionMemory firm={firm} allFirms={allFirms} firmsLoading={firmsLoading} />

        <HardGates
          firm={firm}
          edits={edits}
          setAxis={setAxis}
          focused={focused}
          setFocused={setFocused}
        />

        <FindingsSection
          firm={firm}
          actionFirm={actionFirm}
          edits={edits}
          onApply={(axis, value) => {
            // Legacy path — analyst-typed / conflict-resolved value.
            // Coerce booleans + numbers so a hard-gate axis picks up as
            // typed data rather than being ignored by HardGates' segmented
            // control (which only honors real booleans).
            const key = FINDING_AXIS_TO_KEY[(axis ?? "").trim().toLowerCase()];
            if (key === undefined) {
              return;
            }
            const coerced = coerceFindingValue(key, value);
            if (coerced === undefined) {
              return;
            }
            setAxis(key, coerced);
          }}
          applyEdit={setAxis}
          pendingVerify={pendingVerify}
          queueVerify={queueVerify}
        />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <ConfirmChecklist firm={firm} mirror={after} edits={edits} />
          <SourceExcerpts findings={findings} />
        </div>
      </main>

      <YourCallRail
        firm={firm}
        actionFirm={actionFirm}
        onCommit={onCommit}
        dirty={dirty}
        enrichPending={enrich.isPending}
        enrichError={enrich.error ?? (flushError === null ? undefined : flushError)}
      />
    </div>
  );
}

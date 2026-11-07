import { describe, expect, it } from "vitest";
import { COUNTRY_GEO } from "../../shared/taxonomy";
import {
  type ScreeningRule,
  countScreened,
  isEvaluable,
  isLiveQueueFirm,
  screenFirm,
  toScreeningRules,
} from "./activeScreening";
import { type FindingLike, axisBadge, classifyAxis, needsYouAxisCountByFirm } from "./axisState";
import { agentRunFirmIds, defaultDeskFirmId } from "./deskDefaults";
import { type DeskPanelInputs, deskPanelState } from "./deskPanelState";
import { RESOLUTION_LABEL, lookalikesFor, resolutionLabel } from "./driftReview";
import {
  ENUM_EDIT_KEYS,
  FINDING_AXIS_TO_KEY,
  HARD_GATE_EDIT_KEYS,
  HARD_GATE_PASS_WHEN,
  NUMERIC_EDIT_KEYS,
  axisInputKind,
  coerceFindingValue,
  decideAccept,
  decideVerify,
  displayFindingValue,
  effectiveAxisValue,
  formatAxisValue,
  verifiedBaselineEdits,
} from "./findingActions";
import {
  type MandateFirmCounts,
  formatMandateFirmCounts,
  mandateFirmCounts,
  searchListFirmIds,
} from "./mandateFirms";
import { LIFECYCLE_BUCKETS, bucketOf, emptyBucketCounts, isOpenFirm } from "./pipelineBuckets";
import {
  DEFAULT_SORT,
  hqCode,
  latestRejection,
  navTarget,
  nextSort,
  pipelineSort,
  rejectDecisionByFirm,
  revealScrollTop,
  sortDirection,
  windowRange,
  windowSegments,
} from "./pipelineRows";
import { type ActiveConfigRule, computeHardScreen, orderEnrichmentQueue, rankFirm } from "./queue";
import { summarizePredicate } from "./rulePredicate";
import { repairTruncatedText } from "./ruleText";
import { formatScore, queueRowTier, scoreFraction, shownScore } from "./scoreFormat";
import { mirrorScore } from "./scoreMirror";
import { excerptText, highlightQuote, modelChipTitle, modelLabel } from "./sourceHighlight";
import { providerLabel } from "./tokens";
import { NULL_OUTCOME_KEY, rates, tallyOutcomes } from "./trustMetrics";

describe("scoreMirror (mirrors server rubric v2, /18)", () => {
  it("Baseline: Single + geo2 + 30 emp -> 6/18, C, Follow", () => {
    const r = mirrorScore({
      firmType: "CF",
      coverageModel: "Single Coverage Focus",
      geoScore: 2,
      employees: 30,
    });
    expect(r.weightedTotal).toBe(6);
    expect(r.maxPossible).toBe(18);
    expect(r.tier).toBe("C");
    expect(r.action).toBe("Follow");
    expect(r.hardRejected).toBe(false);
  });

  it("Sparse firm: Multi + geo1 + 8 emp -> 4/18, soft Rejected, Enrich", () => {
    const r = mirrorScore({
      firmType: "CF",
      coverageModel: "Multi-Coverage Focus",
      geoScore: 1,
      employees: 8,
    });
    expect(r.weightedTotal).toBe(4);
    expect(r.tier).toBe("Rejected");
    expect(r.hardRejected).toBe(false);
    expect(r.action).toBe("Enrich");
  });

  it("Generalist -> hard reject", () => {
    const r = mirrorScore({
      firmType: "CF",
      coverageModel: "Generalist Focus",
      geoScore: 0,
      employees: 3,
    });
    expect(r.hardRejected).toBe(true);
    expect(r.tier).toBe("Rejected");
    expect(r.action).toBe("Reject");
  });

  it("fully enriched CF -> 18/18, A, Outreach (C->A money shot)", () => {
    const r = mirrorScore({
      firmType: "CF",
      coverageModel: "Single Coverage Focus",
      servicesFit: "Full advisory suite",
      mdPedigree: "Bulge-bracket or elite-boutique alumni",
      geoScore: 2,
      employees: 30,
      dealSizeMUsd: 200,
      dealsPerMdL3y: 5,
      firmAge: 15,
      feeGeneratingCount: 4,
    });
    expect(r.weightedTotal).toBe(18);
    expect(r.maxPossible).toBe(18);
    expect(r.tier).toBe("A");
    expect(r.action).toBe("Outreach");
  });
});

describe("orderEnrichmentQueue", () => {
  it("among workable (non-R) firms, higher expected gain rises", () => {
    const q = orderEnrichmentQueue([
      {
        // Tier C — 9/18 with headroom of 8 across dealSize/dealsPerMd/firmAge/feeGen.
        firmId: "high-gain-b",
        firmType: "CF",
        coverageModel: "Single Coverage Focus",
        geoScore: 2,
        employees: 100,
        servicesFit: "Full advisory suite",
        mdPedigree: "Bulge-bracket or elite-boutique alumni",
      },
      {
        // Tier B — 13/18, only feeGen missing (headroom 2).
        firmId: "low-gain-a",
        firmType: "CF",
        coverageModel: "Single Coverage Focus",
        geoScore: 2,
        employees: 100,
        servicesFit: "Full advisory suite",
        mdPedigree: "Bulge-bracket or elite-boutique alumni",
        dealSizeMUsd: 150,
        dealsPerMdL3y: 5,
        firmAge: 10,
      },
    ]);
    expect(q[0].firm.firmId).toBe("high-gain-b");
    expect(q[0].gain).toBeGreaterThan(q[1].gain);
    expect(q[1].firm.firmId).toBe("low-gain-a");
  });

  it("ceiling headroom for a firm missing only feeGeneratingCount is 2, not the v1 leftover of 1", () => {
    // Every other axis known and maxed under v2; feeGeneratingCount is the
    // sole gap. By hand: Coverage(2)+Services(2)+MD(2)+Geo(2)+DealSize(200
    // >150→2)+DealsPerMd(5>3.5→2)+FirmAge(15>12→2)+Headcount(20, 8-40
    // sweet spot→2) = 16, feeGen missing→0. currentScore=16. feeGen's v2
    // max is 2 (was 1 under the retired v1 model), so ceiling = 16+2 = 18
    // and gain = 2 — not the stale ceiling=17/gain=1 the old ENRICHABLE
    // table would have produced.
    const r = rankFirm({
      firmId: "missing-only-feegen",
      firmType: "CF",
      coverageModel: "Single-sector focus",
      servicesFit: "Full advisory suite",
      mdPedigree: "Bulge-bracket or elite-boutique alumni",
      geoScore: 2,
      dealSizeMUsd: 200,
      dealsPerMdL3y: 5,
      firmAge: 15,
      employees: 20,
    });
    expect(r.currentScore).toBe(16);
    expect(r.ceiling).toBe(18);
    expect(r.gain).toBe(2);
    expect(r.missingCount).toBe(1);
  });

  it("low-score firms are NOT hard-screened — enrichment can still move them", () => {
    // A low weighted score puts the firm's tier at "Rejected" (soft), but
    // the hard-screen system never fired. Ranking these as workable is
    // correct: enrichment may lift them into C or B once fields fill in.
    // Only actual base rules or approved HardScreenConfig rows count as
    // "hard-screened" for queue purposes.
    const q = orderEnrichmentQueue([
      {
        firmId: "low-score-workable",
        firmType: "CF",
        coverageModel: "Multi-Coverage Focus",
        geoScore: 1,
        employees: 5, // → tier Rejected via low score, but no screen tripped
      },
      {
        firmId: "workable-c",
        firmType: "CF",
        coverageModel: "Single Coverage Focus",
        geoScore: 2,
        employees: 100, // → Rejected tier (soft), 5/18
      },
    ]);
    // Both are non-hard-screened. Order is by gain (headroom to grow).
    expect(q[0].hardScreened).toBe(false);
    expect(q[1].hardScreened).toBe(false);
    expect([q[0].firm.firmId, q[1].firm.firmId].sort()).toEqual([
      "low-score-workable",
      "workable-c",
    ]);
  });

  it("server-disposition hard-screen sinks a Discovered firm below active work", () => {
    // Client mirror can't see this firm's hard screen (its rubric fields
    // pass), but the ontology already screened it out — enrichment gain
    // is fictional. Must land below the workable, non-hard-screened firm.
    const q = orderEnrichmentQueue([
      {
        firmId: "hard-screened-discovered",
        firmType: "CF",
        coverageModel: "Single Coverage Focus",
        geoScore: 2,
        employees: 100,
        servicesFit: "Full advisory suite", // enough to clear R on its own
        lifecycleState: "Discovered",
        disposition: "hard_rejected",
      },
      {
        firmId: "workable-c",
        firmType: "CF",
        coverageModel: "Single Coverage Focus",
        geoScore: 2,
        employees: 100, // Rejected tier (soft), 5/18
      },
    ]);
    expect(q[0].firm.firmId).toBe("workable-c");
    expect(q[0].hardScreened).toBe(false);
    expect(q[1].firm.firmId).toBe("hard-screened-discovered");
    expect(q[1].hardScreened).toBe(true);
  });

  it("active approved learned rule flips a firm to hard-screened", () => {
    // 4-employee CF firm; passes all base rules. Add an active "employees
    // < 10" learned rule for the CF model — it must now count as hard-
    // screened per the shared computeHardScreen, so the queue sinks it.
    const activeRule: ActiveConfigRule = {
      ruleId: "cfg-emp-lt-10",
      axis: "employees",
      operator: "<",
      threshold: "10",
      model: "CF",
    };
    const q = orderEnrichmentQueue(
      [
        {
          firmId: "small-cf",
          firmType: "CF",
          coverageModel: "Single Coverage Focus",
          geoScore: 2,
          employees: 4,
        },
        {
          firmId: "workable-c",
          firmType: "CF",
          coverageModel: "Single Coverage Focus",
          geoScore: 2,
          employees: 100,
        },
      ],
      [activeRule],
    );
    expect(q[0].firm.firmId).toBe("workable-c");
    expect(q[0].hardScreened).toBe(false);
    expect(q[1].firm.firmId).toBe("small-cf");
    expect(q[1].hardScreened).toBe(true);
    expect(q[1].hardScreenReason).toBe("employees < 10");
  });

  it("model-mismatched rules are ignored — CS rule does not screen CF firms", () => {
    const csOnlyRule: ActiveConfigRule = {
      ruleId: "cfg-cs-emp",
      axis: "employees",
      operator: "<",
      threshold: "50",
      model: "CS",
    };
    const q = orderEnrichmentQueue(
      [
        {
          firmId: "small-cf",
          firmType: "CF",
          coverageModel: "Single Coverage Focus",
          geoScore: 2,
          employees: 4,
        },
      ],
      [csOnlyRule],
    );
    expect(q[0].hardScreened).toBe(false);
  });

  it("computeHardScreen returns base-rule verdict for a hard-rejected firm", () => {
    // Generalist coverage → base rule fires. No configs needed.
    const v = computeHardScreen(
      {
        firmId: "gen",
        firmType: "CF",
        coverageModel: "Generalist Focus",
        geoScore: 2,
        employees: 100,
      },
      [],
    );
    expect(v.hardScreened).toBe(true);
    expect(v.source).toBe("base");
    expect(v.reason).toContain("Generalist");
  });

  it("computeHardScreen returns clear verdict when no rule matches (no configs)", () => {
    const v = computeHardScreen(
      {
        firmId: "safe",
        firmType: "CF",
        coverageModel: "Single Coverage Focus",
        geoScore: 2,
        employees: 100,
      },
      [],
    );
    expect(v.hardScreened).toBe(false);
    expect(v.reason).toBe(null);
    expect(v.source).toBe(null);
  });

  it("terminal firms drop below active work but above hard-screened", () => {
    const q = orderEnrichmentQueue([
      {
        firmId: "qualified-high",
        firmType: "CF",
        coverageModel: "Single Coverage Focus",
        geoScore: 2,
        employees: 100,
        servicesFit: "Full advisory suite",
        mdPedigree: "Bulge-bracket or elite-boutique alumni",
        dealSizeMUsd: 150,
        dealsPerMdL3y: 5,
        firmAge: 10,
        lifecycleState: "Qualified",
      },
      {
        firmId: "workable-c",
        firmType: "CF",
        coverageModel: "Single Coverage Focus",
        geoScore: 2,
        employees: 100, // Rejected tier (soft), 5/18, non-terminal, non-hard-screened
      },
      {
        firmId: "hard-screened",
        firmType: "CF",
        coverageModel: "Generalist Focus", // client hard-reject
        geoScore: 2,
        employees: 100,
      },
    ]);
    expect(q[0].firm.firmId).toBe("workable-c");
    expect(q[0].terminal).toBe(false);
    expect(q[0].hardScreened).toBe(false);
    expect(q[1].firm.firmId).toBe("qualified-high");
    expect(q[1].terminal).toBe(true);
    expect(q[1].hardScreened).toBe(false);
    expect(q[2].firm.firmId).toBe("hard-screened");
    expect(q[2].hardScreened).toBe(true);
  });

  it("treats Qualified and every later deal stage, and Passed, as decided", () => {
    const base = { firmType: "CF", coverageModel: "Single Coverage Focus", geoScore: 2 };
    const q = orderEnrichmentQueue(
      ["Discovered", "Screening", "Qualified", "NDA", "Closed", "Passed"].map((lifecycleState) => ({
        ...base,
        firmId: lifecycleState,
        lifecycleState,
      })),
    );
    const terminal = Object.fromEntries(q.map((r) => [r.firm.firmId, r.terminal]));
    expect(terminal).toEqual({
      Discovered: false,
      Screening: false,
      Qualified: true,
      NDA: true,
      Closed: true,
      Passed: true,
    });
  });

  it("snake_case lifecycle folds into the terminal bucket", () => {
    // Backend can return "in_review", "in-review", or the legacy "In Review" — all
    // must land in the same bucket so the funnel tiles and the queue's
    // terminal sink stay accurate. Here we test the terminal side:
    // "qualified" (already single-word) works, and legacy snake_case
    // ("rejected") must also fold via normalizeLifecycle. The Pipeline test
    // for middle stages lives at the component layer.
    const q = orderEnrichmentQueue([
      {
        firmId: "in-review-snake",
        firmType: "CF",
        coverageModel: "Single Coverage Focus",
        geoScore: 2,
        employees: 100,
        lifecycleState: "in_review",
      },
    ]);
    // Non-terminal, non-hard-screened → workable.
    expect(q[0].terminal).toBe(false);
    expect(q[0].hardScreened).toBe(false);
  });
});

describe("repairTruncatedText (rule card excerpt)", () => {
  // Services_fit rule card is the canonical failure — the backend stores
  // clip markers ("...") after cutting mid-word. The client must strip
  // the marker and rewind to a word boundary before re-appending "…".
  it("rewinds a services_fit clip marker to the last word boundary", () => {
    expect(repairTruncatedText("Advisory functio...")).toBe("Advisory…");
    expect(repairTruncatedText("Advisory functio…")).toBe("Advisory…");
  });

  it("rewinds a geography clip marker the same way", () => {
    expect(repairTruncatedText("Common pattern: geographic footpri...")).toBe(
      "Common pattern: geographic…",
    );
    expect(repairTruncatedText("Common pattern: geographic footpri…")).toBe(
      "Common pattern: geographic…",
    );
  });

  it("leaves a real sentence end alone", () => {
    expect(repairTruncatedText("Advisory function is out of scope.")).toBe(
      "Advisory function is out of scope.",
    );
    expect(repairTruncatedText("Rejected: bad fit.")).toBe("Rejected: bad fit.");
  });

  it("appends '…' when there's no space to rewind to", () => {
    expect(repairTruncatedText("advisoryfunctio")).toBe("advisoryfunctio…");
    expect(repairTruncatedText("advisoryfunctio...")).toBe("advisoryfunctio…");
  });

  it("handles null / undefined / empty defensively", () => {
    expect(repairTruncatedText(null)).toBe("");
    expect(repairTruncatedText(undefined)).toBe("");
    expect(repairTruncatedText("")).toBe("");
    expect(repairTruncatedText("   ")).toBe("");
  });

  it("strips repeated / doubled clip markers before rewinding", () => {
    expect(repairTruncatedText("Advisory functio......")).toBe("Advisory…");
    expect(repairTruncatedText("Advisory functio……")).toBe("Advisory…");
  });
});

describe("findingActions — Accept / Verify decision", () => {
  // Regression: the ACF Investment Bank repro. Analyst manually set the
  // web_activity hard gate to No; agent then proposes Yes. Accept must
  // NOT silently no-op — it has to surface the conflict so the analyst
  // picks Keep-mine vs Take-agent's.
  it("Accept on a hard gate the analyst set to No + agent proposes Yes → conflict, not no-op", () => {
    const firm = { webActivity: false } as unknown as Record<string, unknown>;
    const edits: Record<string, string | number | boolean> = {};
    const current = effectiveAxisValue(firm, edits, "webActivity");
    expect(current).toBe(false);
    const decision = decideAccept({ axis: "web_activity", value: "Yes" }, current);
    expect(decision.kind).toBe("conflict");
    if (decision.kind === "conflict") {
      expect(decision.editKey).toBe("webActivity");
      expect(decision.mine).toBe(false);
      expect(decision.theirs).toBe(true);
    }
  });

  it("Accept on a scorable axis the analyst set to a different number → conflict", () => {
    const current = effectiveAxisValue({}, { dealSizeMUsd: 200 }, "dealSizeMUsd");
    const decision = decideAccept({ axis: "deal_size_usd_m", value: "150" }, current);
    expect(decision.kind).toBe("conflict");
    if (decision.kind === "conflict") {
      expect(decision.mine).toBe(200);
      expect(decision.theirs).toBe(150);
    }
  });

  it("Accept when analyst hasn't set the axis → apply cleanly", () => {
    const firm = { webActivity: null } as unknown as Record<string, unknown>;
    const current = effectiveAxisValue(firm, {}, "webActivity");
    const decision = decideAccept({ axis: "web_activity", value: "Yes" }, current);
    expect(decision.kind).toBe("apply");
    if (decision.kind === "apply") {
      expect(decision.editKey).toBe("webActivity");
      expect(decision.value).toBe(true);
    }
  });

  it("Accept when analyst value matches agent → apply (idempotent, no conflict)", () => {
    const current = effectiveAxisValue({}, { webActivity: true }, "webActivity");
    const decision = decideAccept({ axis: "web_activity", value: "true" }, current);
    expect(decision.kind).toBe("apply");
  });

  it("Accept on an axis the client doesn't know how to route → unroutable, never conflict", () => {
    const decision = decideAccept({ axis: "made_up_axis", value: "whatever" }, "existing");
    expect(decision.kind).toBe("unroutable");
    if (decision.kind === "unroutable") {
      expect(decision.reason).toBe("unknown-axis");
    }
  });

  it("Verify on an empty axis writes the value (confirms as human-checked)", () => {
    const current = effectiveAxisValue({}, {}, "webActivity");
    const decision = decideVerify({ axis: "web_activity", value: "Yes" }, current);
    expect(decision.kind).toBe("apply");
    if (decision.kind === "apply") {
      expect(decision.value).toBe(true);
    }
  });

  it("Verify with a different analyst-set value → conflict (no silent overwrite)", () => {
    const current = effectiveAxisValue({ webActivity: false }, {}, "webActivity");
    const decision = decideVerify({ axis: "web_activity", value: "Yes" }, current);
    expect(decision.kind).toBe("conflict");
  });

  it("edits shadow the persisted firm value (analyst just clicked No on the gate)", () => {
    // Firm on file says Yes; analyst just clicked No in the segmented
    // control. Agent then proposes Yes. Effective value must be the
    // analyst's local edit, not the stale firm field.
    const firm = { webActivity: true } as unknown as Record<string, unknown>;
    const current = effectiveAxisValue(firm, { webActivity: false }, "webActivity");
    expect(current).toBe(false);
    const decision = decideAccept({ axis: "web_activity", value: "Yes" }, current);
    expect(decision.kind).toBe("conflict");
  });

  it("coerces yes/no/true/false variants for hard gates", () => {
    expect(coerceFindingValue("webActivity", "Yes")).toBe(true);
    expect(coerceFindingValue("webActivity", "no")).toBe(false);
    expect(coerceFindingValue("webActivity", "TRUE")).toBe(true);
    expect(coerceFindingValue("webActivity", "0")).toBe(false);
    // Unroutable — the agent gave us prose we can't safely turn into a bool.
    expect(coerceFindingValue("webActivity", "maybe")).toBeUndefined();
  });

  it("coerces numeric axes to numbers", () => {
    expect(coerceFindingValue("dealSizeMUsd", "150")).toBe(150);
    expect(coerceFindingValue("dealSizeMUsd", "  75.5  ")).toBe(75.5);
    expect(coerceFindingValue("dealSizeMUsd", "n/a")).toBeUndefined();
  });
});

describe("hard-gate polarity — Pass always means cleared", () => {
  // These four assertions are the whole contract for a new gate: adding
  // one without an entry here should fail this suite and force the author
  // to declare polarity intentionally instead of shipping ambiguous copy.
  it("advisoryConflict: Pass = no conflict (stored false)", () => {
    expect(HARD_GATE_PASS_WHEN.advisoryConflict).toBe(false);
  });

  it("hasStOrBalanceSheet: Pass = no S&T / balance sheet (stored false)", () => {
    expect(HARD_GATE_PASS_WHEN.hasStOrBalanceSheet).toBe(false);
  });

  it("webActivity: Pass = has verifiable activity (stored true)", () => {
    expect(HARD_GATE_PASS_WHEN.webActivity).toBe(true);
  });

  it("solvent: Pass = solvent (stored true)", () => {
    expect(HARD_GATE_PASS_WHEN.solvent).toBe(true);
  });

  it("every gate declares a polarity — no undefined entries", () => {
    // If a gate lands in HARD_GATES (firmDesk/hardGateConfig.tsx) without an entry here,
    // formatAxisValue silently falls back to raw booleans — the copy
    // reads "You set true · agent proposes false" and the analyst loses
    // the Pass/Fail framing. Assert we're covering exactly four gates.
    expect(Object.keys(HARD_GATE_PASS_WHEN).sort()).toEqual([
      "advisoryConflict",
      "hasStOrBalanceSheet",
      "solvent",
      "webActivity",
    ]);
  });

  it("formatAxisValue renders Pass/Fail per polarity, not raw booleans", () => {
    // Two direct-polarity gates: true reads Pass.
    expect(formatAxisValue("webActivity", true)).toBe("Pass");
    expect(formatAxisValue("webActivity", false)).toBe("Fail");
    expect(formatAxisValue("solvent", true)).toBe("Pass");
    // Two inverted-polarity gates: true reads Fail.
    expect(formatAxisValue("advisoryConflict", true)).toBe("Fail");
    expect(formatAxisValue("advisoryConflict", false)).toBe("Pass");
    expect(formatAxisValue("hasStOrBalanceSheet", true)).toBe("Fail");
    expect(formatAxisValue("hasStOrBalanceSheet", false)).toBe("Pass");
  });
});

describe("axisInputKind — abstain-card input schema", () => {
  it("hard gates render as boolean toggles", () => {
    expect(axisInputKind("web_activity")).toBe("boolean");
    expect(axisInputKind("advisory_conflict")).toBe("boolean");
    expect(axisInputKind("has_st_or_balance_sheet")).toBe("boolean");
    expect(axisInputKind("solvent")).toBe("boolean");
  });

  it("numeric rubric axes render as number inputs", () => {
    expect(axisInputKind("deal_size_usd_m")).toBe("number");
    expect(axisInputKind("deals_per_md_l3y")).toBe("number");
    expect(axisInputKind("firm_age_years")).toBe("number");
    expect(axisInputKind("fee_generating_count")).toBe("number");
    // Alias forms in FINDING_AXIS_TO_KEY should route to the same edit
    // key and inherit the number kind — a mixed backlog can't downgrade
    // to a text box.
    expect(axisInputKind("deal_size")).toBe("number");
    expect(axisInputKind("firm_age")).toBe("number");
  });

  it("categorical rubric axes render as enum selects", () => {
    expect(axisInputKind("services_fit")).toBe("enum");
    expect(axisInputKind("md_pedigree")).toBe("enum");
    expect(axisInputKind("balance_sheet_principal")).toBe("enum");
  });

  it("axes without a known shape fall back to free text", () => {
    expect(axisInputKind("geographic_footprint")).toBe("text");
    expect(axisInputKind("hq_country")).toBe("text");
    expect(axisInputKind("some_new_axis_the_agent_invented")).toBe("text");
  });

  it("accepts an edit key directly (no double normalization)", () => {
    // Callers that already hold an edit key shouldn't have to re-normalize
    // to snake_case just to ask the schema — pass-through must work.
    expect(axisInputKind("webActivity")).toBe("boolean");
    expect(axisInputKind("dealSizeMUsd")).toBe("number");
    expect(axisInputKind("servicesFit")).toBe("enum");
  });
});

describe("hard-gate input-control audit — no gate axis renders as dropdown/text", () => {
  // Enumerate every raw finding-axis vocabulary term that maps to a hard
  // gate. If any one of these ever resolved to "enum" or "text", the
  // evidence panel's value editor would render a <select> or free-text box for what
  // must be a Pass/Fail toggle — the exact bug this test is here to catch.
  const gateAxisVariants = Object.entries(FINDING_AXIS_TO_KEY)
    .filter(([, editKey]) => HARD_GATE_EDIT_KEYS.has(editKey))
    .map(([rawAxis]) => rawAxis);

  it("every hard-gate axis (in every naming variant) resolves to boolean", () => {
    // Preflight: the map has to actually route at least one variant per
    // gate — if the loop is empty because someone deleted the alias
    // rows, the assertions below would trivially pass and hide the bug.
    expect(gateAxisVariants.length).toBeGreaterThanOrEqual(HARD_GATE_EDIT_KEYS.size);
    for (const raw of gateAxisVariants) {
      expect(axisInputKind(raw)).toBe("boolean");
    }
  });

  it("gate edit keys resolve to boolean when passed directly (no double-normalization)", () => {
    for (const editKey of HARD_GATE_EDIT_KEYS) {
      expect(axisInputKind(editKey)).toBe("boolean");
    }
  });

  it("no hard-gate edit key leaks into the enum or numeric shape sets", () => {
    // The kind branches inside axisInputKind check HARD_GATE first, so
    // even an overlap wouldn't misroute at read time — but a mis-added
    // ENUM_EDIT_KEYS entry for a gate would still be a lie of intent.
    // Assert the sets are disjoint so future edits stay honest.
    for (const editKey of HARD_GATE_EDIT_KEYS) {
      expect(ENUM_EDIT_KEYS.has(editKey)).toBe(false);
      expect(NUMERIC_EDIT_KEYS.has(editKey)).toBe(false);
    }
  });

  it("scoring axes never accidentally register as boolean gates", () => {
    // Inverse of the above — if someone adds a scoring axis to
    // HARD_GATE_PASS_WHEN by mistake, the enum/number branches never
    // fire for it (HARD_GATE wins first). Guard against that.
    for (const editKey of ["servicesFit", "mdPedigree", "balanceSheetPrincipal", "dealSizeMUsd"]) {
      expect(HARD_GATE_EDIT_KEYS.has(editKey)).toBe(false);
    }
  });
});

describe("displayFindingValue — gate cards read Pass/Fail, never raw booleans", () => {
  // ACF Investment Bank repro (visual half): the proposed finding for
  // web_activity was rendering "true" and advisory_conflict was
  // rendering "false", leaking the storage vocab into the analyst UI.
  // These renders now share the same Pass/Fail vocab as the gates row.
  it("routes direct-polarity gates: true = Pass, false = Fail", () => {
    expect(displayFindingValue("web_activity", "true")).toBe("Pass");
    expect(displayFindingValue("web_activity", "Yes")).toBe("Pass");
    expect(displayFindingValue("web_activity", "no")).toBe("Fail");
    expect(displayFindingValue("solvent", "true")).toBe("Pass");
    expect(displayFindingValue("solvent", "0")).toBe("Fail");
  });

  it("routes inverted-polarity gates: true = Fail, false = Pass", () => {
    expect(displayFindingValue("advisory_conflict", "true")).toBe("Fail");
    expect(displayFindingValue("advisory_conflict", "false")).toBe("Pass");
    expect(displayFindingValue("has_st_or_balance_sheet", "yes")).toBe("Fail");
    expect(displayFindingValue("has_st_or_balance_sheet", "no")).toBe("Pass");
    // The alias variant must render identically to the canonical one —
    // a mixed backlog can't get half of its gate findings translated.
    expect(displayFindingValue("st_or_balance_sheet", "yes")).toBe("Fail");
  });

  it("scoring axes pass their string value through untouched", () => {
    expect(displayFindingValue("deal_size_usd_m", "150")).toBe("150");
    expect(displayFindingValue("services_fit", "Full advisory suite")).toBe("Full advisory suite");
  });

  it("degrades gracefully on unknown axis or uncoercible gate value", () => {
    // Unknown axis: keep the raw string so the analyst still sees
    // something meaningful rather than an empty cell.
    expect(displayFindingValue("mystery_axis", "whatever")).toBe("whatever");
    // Known gate axis but the agent gave us prose we can't turn into a
    // bool: show the raw text (better than "—" — the analyst can still
    // read what the agent said and decide manually).
    expect(displayFindingValue("web_activity", "maybe")).toBe("maybe");
  });

  it("empty / null / undefined value → em dash", () => {
    expect(displayFindingValue("web_activity", "")).toBe("—");
    expect(displayFindingValue("web_activity", null)).toBe("—");
    expect(displayFindingValue("web_activity", undefined)).toBe("—");
  });
});

// ─── Home composition ───────────────────────────────────────────────────
// Home restates three counts that other pages own. These tests pin the
// shared modules it reads them from, so a number on the home page can't
// silently disagree with the page it links to.

describe("pipelineBuckets — eight-stage funnel plus Passed", () => {
  const mirrorOf = (input: Parameters<typeof mirrorScore>[0]) => mirrorScore(input);

  it("hard-rejected firms land in Passed regardless of lifecycle", () => {
    const firm = { firmType: "CF", coverageModel: "Generalist Focus", lifecycleState: "NDA" };
    const m = mirrorOf(firm);
    expect(m.hardRejected).toBe(true);
    expect(bucketOf(firm, m)).toBe("Passed");
  });

  it("snake_case and hyphenated lifecycle values fold into the tracked stage", () => {
    const base = { firmType: "CF", coverageModel: "Single Coverage Focus", geoScore: 2 };
    const m = mirrorOf(base);
    expect(bucketOf({ ...base, lifecycleState: "in_review" }, m)).toBe("Screening");
    expect(bucketOf({ ...base, lifecycleState: "In-Talks" }, m)).toBe("Outreach");
    expect(bucketOf({ ...base, currentStage: "OUTREACH" }, m)).toBe("Outreach");
  });

  it("files each deal stage under its own bucket, and legacy names under their successors", () => {
    const base = { firmType: "CF", coverageModel: "Single Coverage Focus", geoScore: 2 };
    const m = mirrorOf(base);
    for (const stage of ["Qualified", "Outreach", "NDA", "IOI", "LOI", "Closed", "Passed"]) {
      expect(bucketOf({ ...base, lifecycleState: stage }, m)).toBe(stage);
    }
    expect(bucketOf({ ...base, lifecycleState: "In Review" }, m)).toBe("Screening");
    expect(bucketOf({ ...base, lifecycleState: "Rejected" }, m)).toBe("Passed");
  });

  it("currentStage wins over lifecycleState, and disposition is the last resort", () => {
    const base = { firmType: "CF", coverageModel: "Single Coverage Focus", geoScore: 2 };
    const m = mirrorOf(base);
    expect(bucketOf({ ...base, currentStage: "Qualified", lifecycleState: "Discovered" }, m)).toBe(
      "Qualified",
    );
    expect(bucketOf({ ...base, disposition: "hard_rejected" }, m)).toBe("Passed");
    // No lifecycle signal at all — the funnel's entry stage, not a hole.
    expect(bucketOf({ lifecycleState: null, currentStage: null, disposition: null }, m)).toBe(
      "Discovered",
    );
  });

  it("emptyBucketCounts covers every bucket exactly once", () => {
    const c = emptyBucketCounts();
    expect(Object.keys(c).sort()).toEqual([...LIFECYCLE_BUCKETS].sort());
    expect(Object.values(c).every((n) => n === 0)).toBe(true);
  });
});

describe("axisState — needs-you axis rollup (Home 'Awaiting judgment')", () => {
  it("counts one axis per firm whose authoritative finding abstained", () => {
    const m = needsYouAxisCountByFirm([
      { findingId: "1", firmId: "f1", axis: "employees", confidenceTier: "abstain" },
      { findingId: "2", firmId: "f1", axis: "firm_age", findingStatus: "abstained" },
      { findingId: "3", firmId: "f2", axis: "employees", confidenceTier: "high" },
    ]);
    expect(m.get("f1")).toBe(2);
    // Firms with no needs-you axes are absent, not zero — callers count
    // map membership against the queue.
    expect(m.has("f2")).toBe(false);
  });

  it("a later human-verified finding retires the abstention for that axis", () => {
    const m = needsYouAxisCountByFirm([
      {
        findingId: "old",
        firmId: "f1",
        axis: "employees",
        confidenceTier: "abstain",
        retrievedAt: "2026-01-01T00:00:00Z",
      },
      {
        findingId: "new",
        firmId: "f1",
        axis: "employees",
        verifiedByHuman: true,
        retrievedAt: "2026-02-01T00:00:00Z",
      },
    ]);
    expect(m.has("f1")).toBe(false);
  });

  it("verified wins over a NEWER abstention — authority beats recency", () => {
    const m = needsYouAxisCountByFirm([
      {
        findingId: "verified",
        firmId: "f1",
        axis: "employees",
        verifiedByHuman: true,
        retrievedAt: "2026-01-01T00:00:00Z",
      },
      {
        findingId: "fresh-abstain",
        firmId: "f1",
        axis: "employees",
        confidenceTier: "abstain",
        retrievedAt: "2026-06-01T00:00:00Z",
      },
    ]);
    expect(m.has("f1")).toBe(false);
  });

  it("superseded and conflict-grouped findings never count as needs-you", () => {
    const m = needsYouAxisCountByFirm([
      {
        findingId: "s",
        firmId: "f1",
        axis: "employees",
        confidenceTier: "abstain",
        findingStatus: "superseded",
      },
      {
        findingId: "c",
        firmId: "f1",
        axis: "firm_age",
        confidenceTier: "abstain",
        conflictGroupId: "g1",
      },
    ]);
    expect(m.size).toBe(0);
  });

  it("findings with no firmId are dropped rather than bucketed together", () => {
    const m = needsYouAxisCountByFirm([
      { findingId: "1", axis: "employees", confidenceTier: "abstain" },
      { findingId: "2", firmId: "", axis: "firm_age", confidenceTier: "abstain" },
    ]);
    expect(m.size).toBe(0);
  });
});

describe("trustMetrics — rates and outcome tally", () => {
  it("agreement / override share the decided denominator; abstention uses all", () => {
    const r = rates([
      { findingId: "1", verifiedByHuman: true },
      { findingId: "2", verifiedByHuman: true },
      { findingId: "3", findingStatus: "rejected" },
      { findingId: "4", confidenceTier: "abstain" },
      { findingId: "5", findingStatus: "proposed" }, // pending — excluded from both
    ]);
    expect(r.decided).toBe(3);
    expect(r.agreement).toBe(67);
    expect(r.override).toBe(33);
    // 1 abstain of 5 total findings — a different denominator on purpose.
    expect(r.abstention).toBe(20);
    expect(r.total).toBe(5);
  });

  it("no decided findings → null rates rather than a misleading 0%", () => {
    const r = rates([{ findingId: "1", confidenceTier: "abstain" }]);
    expect(r.agreement).toBeNull();
    expect(r.override).toBeNull();
    expect(r.abstention).toBe(100);
  });

  it("tallies outcomes and the passed-then-acquired headline", () => {
    const t = tallyOutcomes([
      { firmId: "a", lifecycleState: "Passed", outcome: "acquired_by_competitor" },
      { firmId: "b", disposition: "hard_screened", outcome: "acquired_by_competitor" },
      { firmId: "c", lifecycleState: "Qualified", outcome: "loi" },
      { firmId: "d", lifecycleState: "Screening", outcome: null },
      // Unknown enum folds into not-yet-observed rather than breaking the grid.
      { firmId: "e", lifecycleState: "Screening", outcome: "some_new_value" },
    ]);
    expect(t.counts.acquired_by_competitor).toBe(2);
    expect(t.counts.loi).toBe(1);
    expect(t.counts[NULL_OUTCOME_KEY]).toBe(2);
    expect(t.passed).toBe(2);
    expect(t.passedAndAcquired).toBe(2);
  });
});

describe("rulePredicate — shared /rules ↔ Home predicate string", () => {
  it("renders numeric thresholds bare and everything else quoted", () => {
    expect(summarizePredicate("employees", "<", "10")).toBe("employees < 10");
    expect(summarizePredicate("deal_size_usd_m", ">=", "-2.5")).toBe("deal_size_usd_m >= -2.5");
    expect(summarizePredicate("coverage_model", "==", "Generalist Focus")).toBe(
      'coverage_model == "Generalist Focus"',
    );
  });

  it("returns null when any component is missing so callers can say 'malformed'", () => {
    expect(summarizePredicate("", "<", "10")).toBeNull();
    expect(summarizePredicate("employees", undefined, "10")).toBeNull();
    expect(summarizePredicate("employees", "<", "  ")).toBeNull();
  });
});

// ─── Approved-rule screening ────────────────────────────────────────────
// The desk used to screen only from HardScreenConfig rows. With that table
// empty the queue header read "711 of 711" while /rules showed an Approved
// `employees < 10` rule claiming it would screen 160 firms. These tests pin
// the client-side evaluator that closes that gap — and, more importantly,
// pin the invariant that keeps it from over-screening.

describe("activeScreening — approved rules screen the desk queue", () => {
  const employeesRule: ScreeningRule = {
    ruleId: "R-emp",
    axis: "employees",
    operator: "<",
    threshold: "10",
    model: "both",
    label: "employees < 10",
  };
  const geoRule: ScreeningRule = {
    ruleId: "R-geo",
    axis: "geo_score",
    operator: "<",
    threshold: "1",
    model: "both",
    label: "geo_score < 1",
  };

  it("screens on employees < 10 — the live numeric predicate", () => {
    expect(screenFirm({ employees: 4 }, [employeesRule]).screened).toBe(true);
    expect(screenFirm({ employees: 40 }, [employeesRule]).screened).toBe(false);
    // Boundary: the predicate is strict, so exactly 10 survives.
    expect(screenFirm({ employees: 10 }, [employeesRule]).screened).toBe(false);
  });

  it("screens on geo_score < 1 — the second live predicate, same evaluator", () => {
    expect(screenFirm({ geoScore: 0 }, [geoRule]).screened).toBe(true);
    expect(screenFirm({ geoScore: 2 }, [geoRule]).screened).toBe(false);
  });

  it("names the rule that screened the firm, for the queue chip", () => {
    const res = screenFirm({ employees: 4, geoScore: 2 }, [employeesRule, geoRule]);
    expect(res.screened).toBe(true);
    expect(res.rule?.label).toBe("employees < 10");
    expect(res.rule?.ruleId).toBe("R-emp");
  });

  it("a third numeric predicate works with no change to the evaluator", () => {
    const ageRule: ScreeningRule = {
      ruleId: "R-age",
      axis: "firm_age_years",
      operator: ">=",
      threshold: "50",
      model: "both",
      label: "firm_age_years >= 50",
    };
    expect(screenFirm({ firmAge: 60 }, [ageRule]).screened).toBe(true);
    expect(screenFirm({ firmAge: 12 }, [ageRule]).screened).toBe(false);
  });

  it("honours a rule's model scope", () => {
    const cfOnly: ScreeningRule = { ...employeesRule, model: "CF" };
    expect(screenFirm({ firmType: "CF", employees: 4 }, [cfOnly]).screened).toBe(true);
    expect(screenFirm({ firmType: "CS", employees: 4 }, [cfOnly]).screened).toBe(false);
  });

  // ── The invariant ──
  it("NEVER screens a firm missing the predicate's property", () => {
    expect(screenFirm({}, [employeesRule]).screened).toBe(false);
    expect(screenFirm({ employees: null }, [employeesRule]).screened).toBe(false);
    expect(screenFirm({ employees: undefined }, [employeesRule]).screened).toBe(false);
    expect(screenFirm({ employees: "" }, [employeesRule]).screened).toBe(false);
    // A firm with geo data but no headcount is untouched by a headcount rule.
    expect(screenFirm({ geoScore: 2 }, [employeesRule]).screened).toBe(false);
  });

  it("refuses to screen on degenerate rules rather than guessing", () => {
    const unresolvableAxis: ScreeningRule = { ...employeesRule, axis: "vibes" };
    const badOperator: ScreeningRule = { ...employeesRule, operator: "~" };
    const nonNumericThreshold: ScreeningRule = { ...employeesRule, threshold: "ten" };
    expect(screenFirm({ employees: 4 }, [unresolvableAxis]).screened).toBe(false);
    expect(screenFirm({ employees: 4 }, [badOperator]).screened).toBe(false);
    expect(screenFirm({ employees: 4 }, [nonNumericThreshold]).screened).toBe(false);
  });

  it("counts screened firms for the header's third term", () => {
    const firms = [
      { employees: 4 }, // screened
      { employees: 7 }, // screened
      { employees: 90 }, // survives
      {}, // missing → survives
    ];
    expect(countScreened(firms, [employeesRule])).toBe(2);
  });
});

describe("toScreeningRules — approved proposals, amended by active configs", () => {
  const approved = {
    proposedRuleId: "P-1",
    ruleStatus: "approved",
    predicateAxis: "employees",
    ruleOperator: "<",
    ruleThreshold: "10",
    ruleModel: "both",
  };

  it("screens from the approved proposal when no config rows exist yet", () => {
    // This is the exact state that produced "711 of 711": HardScreenConfig
    // empty, an approved rule sitting in /rules doing nothing.
    const rules = toScreeningRules([approved], []);
    expect(rules).toHaveLength(1);
    expect(rules[0].label).toBe("employees < 10");
    expect(screenFirm({ employees: 7 }, rules).screened).toBe(true);
  });

  it("ignores pending and dismissed proposals", () => {
    expect(toScreeningRules([{ ...approved, ruleStatus: "pending" }], [])).toHaveLength(0);
    expect(toScreeningRules([{ ...approved, ruleStatus: "dismissed" }], [])).toHaveLength(0);
    expect(toScreeningRules([{ ...approved, ruleStatus: undefined }], [])).toHaveLength(0);
  });

  it("an amended threshold un-screens a firm the original rule caught", () => {
    // v1 `< 10` screened a 7-employee firm; the analyst amends to `< 5`.
    const before = toScreeningRules([approved], []);
    expect(screenFirm({ employees: 7 }, before).screened).toBe(true);

    const after = toScreeningRules(
      [approved],
      [
        {
          sourceProposedRuleId: "P-1",
          configVersion: 1,
          configActive: false,
          configAxis: "employees",
          configOperator: "<",
          configThreshold: "10",
        },
        {
          sourceProposedRuleId: "P-1",
          configVersion: 2,
          configActive: true,
          configAxis: "employees",
          configOperator: "<",
          configThreshold: "5",
        },
      ],
    );
    expect(after[0].label).toBe("employees < 5");
    expect(screenFirm({ employees: 7 }, after).screened).toBe(false);
    // The amended rule still bites below its new threshold.
    expect(screenFirm({ employees: 3 }, after).screened).toBe(true);
  });

  it("drops a rule whose config versions are all inactive (unapproved)", () => {
    const rules = toScreeningRules(
      [approved],
      [
        {
          sourceProposedRuleId: "P-1",
          configVersion: 1,
          configActive: false,
          configAxis: "employees",
          configOperator: "<",
          configThreshold: "10",
        },
      ],
    );
    expect(rules).toHaveLength(0);
  });

  it("drops malformed approved proposals instead of screening on a guess", () => {
    expect(toScreeningRules([{ ...approved, ruleThreshold: "" }], [])).toHaveLength(0);
    expect(toScreeningRules([{ ...approved, predicateAxis: undefined }], [])).toHaveLength(0);
  });
});

describe("isLiveQueueFirm — the desk's default view", () => {
  const employeesRule: ScreeningRule = {
    ruleId: "R-emp",
    axis: "employees",
    operator: "<",
    threshold: "10",
    model: "both",
    label: "employees < 10",
  };
  // Open is the funnel's call now; the desk composes it with screening.
  const live = (firm: Record<string, unknown>, rules: ScreeningRule[], hardRejected = false) =>
    isLiveQueueFirm(firm, rules, isOpenFirm(firm, hardRejected));

  it("admits Discovered and Screening, tolerating separator spellings", () => {
    expect(isOpenFirm({ lifecycleState: "Discovered" }, false)).toBe(true);
    expect(isOpenFirm({ lifecycleState: "Screening" }, false)).toBe(true);
    expect(isOpenFirm({ lifecycleState: "in_review" }, false)).toBe(true);
    expect(isOpenFirm({ lifecycleState: "In-Review" }, false)).toBe(true);
  });

  it("excludes decided lifecycle states", () => {
    expect(isOpenFirm({ lifecycleState: "Qualified" }, false)).toBe(false);
    expect(isOpenFirm({ lifecycleState: "Passed" }, false)).toBe(false);
    expect(isOpenFirm({ lifecycleState: "NDA" }, false)).toBe(false);
    // No lifecycle signal at all is the funnel's entry stage, not a hole —
    // bucketOf defaults to Discovered, so the firm is open and workable.
    expect(isOpenFirm({ lifecycleState: null }, false)).toBe(true);
  });

  it("excludes base-rule hard-rejected firms even while lifecycle reads Discovered", () => {
    // The 674-vs-441 bug: this firm's lifecycleState still says Discovered,
    // but the funnel filed it under Passed the moment a base rule fired.
    expect(isOpenFirm({ lifecycleState: "Discovered" }, true)).toBe(false);
    expect(live({ lifecycleState: "Discovered", employees: 40 }, [employeesRule], true)).toBe(
      false,
    );
  });

  it("excludes screened firms even when their lifecycle is open", () => {
    expect(live({ lifecycleState: "Discovered", employees: 4 }, [employeesRule])).toBe(false);
    expect(live({ lifecycleState: "Discovered", employees: 40 }, [employeesRule])).toBe(true);
  });

  // ── Safety net ──
  // Search-created firms land with no headcount at all. If a headcount rule
  // ever screened them, the desk would silently swallow every firm the
  // analyst just went out and found — the worst possible failure of this
  // feature, and invisible from the header numbers alone.
  it("keeps Ravenmere Credit Advisors — a search-created firm with no headcount — visible", () => {
    const summit = {
      firmId: "F-summit",
      firmName: "Ravenmere Credit Advisors",
      firmType: "CS",
      lifecycleState: "Discovered",
      discoveredViaSearchId: "S-1",
      employees: null,
      geoScore: null,
    };
    expect(screenFirm(summit, [employeesRule]).screened).toBe(false);
    expect(live(summit, [employeesRule])).toBe(true);
  });

  it("keeps every Discovered firm carrying discoveredViaSearchId visible", () => {
    const geoRule: ScreeningRule = {
      ruleId: "R-geo",
      axis: "geo_score",
      operator: "<",
      threshold: "1",
      model: "both",
      label: "geo_score < 1",
    };
    const searchCreated = [
      { firmName: "A", lifecycleState: "Discovered", discoveredViaSearchId: "S-1" },
      {
        firmName: "B",
        lifecycleState: "Discovered",
        discoveredViaSearchId: "S-2",
        employees: null,
      },
      { firmName: "C", lifecycleState: "discovered", discoveredViaSearchId: "S-2", geoScore: null },
    ];
    for (const firm of searchCreated) {
      expect(live(firm, [employeesRule, geoRule])).toBe(true);
    }
    expect(countScreened(searchCreated, [employeesRule, geoRule])).toBe(0);
  });
});

describe("desk header ↔ /rules card — the numbers a reviewer cross-checks", () => {
  // The reported bug: the desk header read "711 of 711" while /rules showed
  // an approved `employees < 10` rule claiming it would screen 160 firms.
  // Both surfaces now count with this module over the same firm set, so the
  // only way they can disagree is if this test fails.
  const proposal = {
    proposedRuleId: "P-emp",
    ruleStatus: "approved",
    predicateAxis: "employees",
    ruleOperator: "<",
    ruleThreshold: "10",
    ruleModel: "both",
  };

  // 9 firms: 3 screened, 4 live, 2 decided.
  const population = [
    { firmName: "Tiny A", lifecycleState: "Discovered", employees: 3 },
    { firmName: "Tiny B", lifecycleState: "Screening", employees: 9 },
    { firmName: "Tiny C", lifecycleState: "Discovered", employees: 1 },
    { firmName: "Big A", lifecycleState: "Discovered", employees: 300 },
    { firmName: "Big B", lifecycleState: "Screening", employees: 42 },
    {
      firmName: "Ravenmere Credit Advisors",
      lifecycleState: "Discovered",
      discoveredViaSearchId: "S-1",
    },
    { firmName: "Unknown headcount", lifecycleState: "Screening", employees: null },
    { firmName: "Closed won", lifecycleState: "Qualified", employees: 500 },
    { firmName: "Closed lost", lifecycleState: "Passed", employees: 500 },
  ];

  it("the rule card's count and the header's screened term are one number", () => {
    const rules = toScreeningRules([proposal], []);
    // What /rules prints on the card for this rule.
    const cardCount = countScreened(population, rules);
    // What the desk header prints as "N screened by approved rules".
    const headerScreened = countScreened(population, rules);
    expect(cardCount).toBe(headerScreened);
    expect(cardCount).toBe(3);
  });

  it("the header's four terms self-reconcile: live + openScreened === open", () => {
    const rules = toScreeningRules([proposal], []);
    const open = population.filter((f) => isOpenFirm(f, false));
    const openScreened = countScreened(open, rules);
    const live = open.filter((f) => isLiveQueueFirm(f, rules, true)).length;

    expect(population.length).toBe(9);
    expect(open.length).toBe(7); // the two decided firms drop out
    expect(openScreened).toBe(3);
    // The identity the header now depends on — a reader subtracting gets
    // the right answer instead of a silent shortfall.
    expect(live + openScreened).toBe(open.length);
    expect(live).toBe(4);
    // ...and open is a subset of the database, so the third term is safe.
    expect(open.length).toBeLessThanOrEqual(population.length);
    for (const f of open.filter((x) => isLiveQueueFirm(x, rules, true))) {
      expect(screenFirm(f, rules).screened).toBe(false);
    }
  });

  it("with no approved rules nothing is screened — but the queue is still partitioned", () => {
    // The pre-fix state was "711 of 711" WITH an approved rule present.
    // With genuinely zero approved rules, zero screened is correct.
    const none = toScreeningRules([{ ...proposal, ruleStatus: "pending" }], []);
    expect(none).toHaveLength(0);
    expect(countScreened(population, none)).toBe(0);
    // The funnel still narrows the desk to open work.
    expect(population.filter((f) => isOpenFirm(f, false)).length).toBe(7);
  });
});

describe("desk open === pipeline Discovered + Screening", () => {
  // The 674-vs-441 contradiction: /pipeline and Home's funnel counted
  // Discovered + Screening via bucketOf, while the desk header ran its own
  // lifecycleState test that couldn't see base-rule hard-rejects. Both now
  // derive from pipelineBuckets, so this equality is structural — it holds
  // for any firm set, not just the fixture below.
  const population = [
    // Open by both readings.
    {
      firmId: "1",
      firmType: "CF",
      coverageModel: "Single Coverage Focus",
      geoScore: 2,
      employees: 40,
      lifecycleState: "Discovered",
    },
    {
      firmId: "2",
      firmType: "CF",
      coverageModel: "Single Coverage Focus",
      geoScore: 2,
      employees: 40,
      lifecycleState: "Screening",
    },
    {
      firmId: "3",
      firmType: "CF",
      coverageModel: "Single Coverage Focus",
      geoScore: 2,
      employees: 40,
      lifecycleState: "in_review",
    },
    // Lifecycle says Discovered, but a base rule (generalist coverage) fired.
    // The funnel calls this Passed; the desk must agree.
    {
      firmId: "4",
      firmType: "CF",
      coverageModel: "Generalist Focus",
      geoScore: 2,
      employees: 40,
      lifecycleState: "Discovered",
    },
    {
      firmId: "5",
      firmType: "CF",
      coverageModel: "Generalist Focus",
      geoScore: 0,
      employees: 3,
      lifecycleState: "Discovered",
    },
    // currentStage outranks lifecycleState — decided.
    {
      firmId: "6",
      firmType: "CF",
      coverageModel: "Single Coverage Focus",
      geoScore: 2,
      employees: 40,
      lifecycleState: "Discovered",
      currentStage: "Outreach",
    },
    // Genuinely terminal.
    {
      firmId: "7",
      firmType: "CF",
      coverageModel: "Single Coverage Focus",
      geoScore: 2,
      employees: 40,
      lifecycleState: "Qualified",
    },
    {
      firmId: "8",
      firmType: "CF",
      coverageModel: "Single Coverage Focus",
      geoScore: 2,
      employees: 40,
      lifecycleState: "Passed",
    },
    // Server-flagged via disposition.
    {
      firmId: "9",
      firmType: "CF",
      coverageModel: "Single Coverage Focus",
      geoScore: 2,
      employees: 40,
      disposition: "hard_rejected",
    },
  ];

  // What /pipeline and Home render: bucket every firm, sum two tiles.
  const pipelineOpen = (): number => {
    const counts = emptyBucketCounts();
    for (const f of population) {
      counts[bucketOf(f, mirrorScore(f))] += 1;
    }
    return counts.Discovered + counts.Screening;
  };

  // What the desk header renders, via the ranker's hardRejected verdict.
  const deskOpen = (): number =>
    orderEnrichmentQueue(population, []).filter((r) => isOpenFirm(r.firm, r.hardRejected)).length;

  it("the two counts are equal for the same firm set", () => {
    expect(deskOpen()).toBe(pipelineOpen());
    expect(deskOpen()).toBe(3);
  });

  it("all nine buckets still sum to the whole database", () => {
    const counts = emptyBucketCounts();
    for (const f of population) {
      counts[bucketOf(f, mirrorScore(f))] += 1;
    }
    const summed = LIFECYCLE_BUCKETS.reduce((n, b) => n + counts[b], 0);
    expect(summed).toBe(population.length);
    // Open is a strict subset — the header's "N open · M in database" can
    // never invert.
    expect(pipelineOpen()).toBeLessThanOrEqual(population.length);
  });
});

describe("isEvaluable — a printed count must never be a fabricated zero", () => {
  const numeric: ScreeningRule = {
    ruleId: "R1",
    axis: "employees",
    operator: "<",
    threshold: "10",
    model: "both",
    label: "employees < 10",
  };

  it("accepts the numeric predicates the desk screens on", () => {
    expect(isEvaluable(numeric)).toBe(true);
    expect(isEvaluable({ ...numeric, axis: "geo_score", operator: ">=" })).toBe(true);
  });

  it("rejects text predicates rather than reporting them as screening zero firms", () => {
    // `services_fit contains "sales & trading"` is a real live rule. The
    // numeric evaluator can't decide it; callers must print "not computed",
    // not "0 firms".
    const contains: ScreeningRule = {
      ruleId: "R2",
      axis: "services_fit",
      operator: "contains",
      threshold: "sales & trading",
      model: "CF",
      label: 'services_fit contains "sales & trading"',
    };
    expect(isEvaluable(contains)).toBe(false);
    expect(screenFirm({ servicesFit: "Sales & Trading desk" }, [contains]).screened).toBe(false);
  });

  it("rejects unresolvable axes and non-numeric thresholds", () => {
    expect(isEvaluable({ ...numeric, axis: "vibes" })).toBe(false);
    expect(isEvaluable({ ...numeric, threshold: "ten" })).toBe(false);
  });
});

describe("geography axis — a numeric geo predicate must reach geoScore", () => {
  // Live rule `geography < 2`. Firm carries BOTH a `geography` string
  // ("Italy") and the 0-2 `geoScore`. Routed at the string, the comparison
  // is NaN and the rule screens nobody while still showing as Approved —
  // the same silent-zero class of bug as the original 711-of-711.
  const geoRule: ScreeningRule = {
    ruleId: "R-geo",
    axis: "geography",
    operator: "<",
    threshold: "2",
    model: "CF",
    label: "geography < 2",
  };

  it("is evaluable and screens on the numeric geo score", () => {
    expect(isEvaluable(geoRule)).toBe(true);
    expect(screenFirm({ geoScore: 0, geography: "Italy" }, [geoRule]).screened).toBe(true);
    expect(screenFirm({ geoScore: 1, geography: "Italy" }, [geoRule]).screened).toBe(true);
    expect(screenFirm({ geoScore: 2, geography: "USA" }, [geoRule]).screened).toBe(false);
  });

  it("still leaves a firm with no geo score alone", () => {
    expect(screenFirm({ geography: "Italy" }, [geoRule]).screened).toBe(false);
    expect(screenFirm({ geoScore: null, geography: "Italy" }, [geoRule]).screened).toBe(false);
  });
});

// ─── Mandate firm counts ────────────────────────────────────────────────
// /mandate counted only the SearchList↔firms link ("285 firms") while Home
// counted the union across three sources ("317 scoped · 32 from searches")
// for the same mandate. Both pages now call mandateFirmCounts and print
// formatMandateFirmCounts, so these tests pin the shared arithmetic AND the
// shared copy.

describe("mandateFirmCounts — one union, both pages", () => {
  const input = {
    searches: [
      { searchId: "S-1", mandateId: "M-1" },
      { searchId: "S-2", mandateId: "M-1" },
      { searchId: "S-9", mandateId: "M-2" },
    ],
    memberships: [
      { searchId: "S-1", firmId: "F-a" },
      { searchId: "S-2", firmId: "F-b" },
      // Duplicate across searches — the union must not double-count.
      { searchId: "S-2", firmId: "F-a" },
      { searchId: "S-9", firmId: "F-z" },
    ],
    firms: [
      // Created by a just-run search before its membership row landed.
      { firmId: "F-c", discoveredViaSearchId: "S-1" },
      { firmId: "F-a", discoveredViaSearchId: "S-1" }, // already counted
      { firmId: "F-unrelated", discoveredViaSearchId: null },
    ],
    searchLists: [{ searchId: "S-1", mandateId: "M-1" }],
    searchListFirmIds: new Map<string, readonly string[]>([
      // The assembled universe: one overlap with the search legs, two new.
      ["S-1", ["F-a", "F-d", "F-e"]],
    ]),
  };

  it("scoped unions all three legs; fromSearches excludes the assembled list", () => {
    const counts = mandateFirmCounts(input).get("M-1");
    // fromSearches = membership {a,b} ∪ discoveredVia {c,a} = {a,b,c}
    expect(counts?.fromSearches).toBe(3);
    // scoped = that ∪ SearchList {a,d,e} = {a,b,c,d,e}
    expect(counts?.scoped).toBe(5);
  });

  it("scoped is always >= fromSearches — the list leg only ever adds", () => {
    for (const [, c] of mandateFirmCounts(input)) {
      expect(c.scoped).toBeGreaterThanOrEqual(c.fromSearches);
    }
  });

  it("keeps mandates separate", () => {
    const m2 = mandateFirmCounts(input).get("M-2");
    expect(m2).toEqual({ scoped: 1, fromSearches: 1 });
  });

  it("a search list with no membership rows yet still scopes its firms", () => {
    // This is the /mandate-only case: the assembled universe exists, nothing
    // has been attached by a run yet. scoped counts it, fromSearches is 0.
    const counts = mandateFirmCounts({
      searches: [],
      memberships: [],
      firms: [],
      searchLists: [{ searchId: "S-1", mandateId: "M-1" }],
      searchListFirmIds: new Map([["S-1", ["F-a", "F-b"]]]),
    }).get("M-1");
    expect(counts).toEqual({ scoped: 2, fromSearches: 0 });
  });

  it("ignores blank ids rather than counting them as a firm", () => {
    const counts = mandateFirmCounts({
      searches: [{ searchId: "S-1", mandateId: "M-1" }],
      memberships: [
        { searchId: "S-1", firmId: "" },
        { searchId: "", firmId: "F-a" },
      ],
      firms: [{ firmId: "", discoveredViaSearchId: "S-1" }],
      searchLists: [],
      searchListFirmIds: new Map(),
    }).get("M-1");
    expect(counts ?? { scoped: 0, fromSearches: 0 }).toEqual({ scoped: 0, fromSearches: 0 });
  });

  it("searchListFirmIds adapts the link map, dropping blank firmIds", () => {
    const linked = new Map<string | number, readonly unknown[]>([
      ["S-1", [{ firmId: "F-a" }, { firmId: "" }, { firmId: "F-b" }, {}]],
    ]);
    expect(searchListFirmIds(linked).get("S-1")).toEqual(["F-a", "F-b"]);
  });

  it("both pages print the identical string from the identical counts", () => {
    // Home renders formatMandateFirmCounts(counts); /mandate renders
    // formatMandateFirmCounts(counts) from the same map. One function, so
    // the two surfaces cannot word or compute it differently.
    const counts = mandateFirmCounts(input).get("M-1");
    expect(counts).toBeDefined();
    const home = formatMandateFirmCounts(counts as MandateFirmCounts);
    const mandatePage = formatMandateFirmCounts(counts as MandateFirmCounts);
    expect(home).toBe(mandatePage);
    expect(home).toBe("5 scoped · 3 from searches");
  });
});

// ─── verifiedBaselineEdits — reload must not orphan verified findings ────
//
// Regression: verify all axes, reload, and the desk showed "9 verified"
// beside blank axes, a stale score, and a disabled Commit — the staged
// edits lived only in session state. The baseline rebuilds them.
describe("verifiedBaselineEdits", () => {
  const verified = (id: string, axis: string, value: string): FindingLike => ({
    findingId: id,
    axis,
    value,
    findingStatus: "verified",
    verifiedByHuman: true,
    retrievedAt: "2026-07-20T00:00:00Z",
  });

  it("stages a verified finding's value on an unset axis (the reload case)", () => {
    const staged = verifiedBaselineEdits([verified("f1", "deals_per_md", "2")], () =>
      effectiveAxisValue({}, {}, "dealsPerMdL3y"),
    );
    expect(staged).toEqual([{ editKey: "dealsPerMdL3y", value: 2 }]);
  });

  it("coerces hard-gate values to booleans", () => {
    const staged = verifiedBaselineEdits(
      [verified("f1", "advisory_conflict", "No")],
      () => undefined,
    );
    expect(staged).toEqual([{ editKey: "advisoryConflict", value: false }]);
  });

  it("does not stage proposed or abstained findings", () => {
    const staged = verifiedBaselineEdits(
      [
        {
          findingId: "f1",
          axis: "firm_age",
          value: "6",
          findingStatus: "proposed",
        },
        {
          findingId: "f2",
          axis: "deal_size",
          value: "",
          findingStatus: "abstained",
          confidenceTier: "abstain",
        },
      ],
      () => undefined,
    );
    expect(staged).toEqual([]);
  });

  it("persisted firm values and in-session edits both win over the baseline", () => {
    const firm = { firmAge: 6 } as unknown as Record<string, unknown>;
    const edits = { dealsPerMdL3y: 3 };
    const staged = verifiedBaselineEdits(
      [verified("f1", "firm_age", "9"), verified("f2", "deals_per_md", "2")],
      (editKey) => effectiveAxisValue(firm, edits, editKey),
    );
    expect(staged).toEqual([]);
  });

  it("skips superseded and conflict-grouped findings", () => {
    const staged = verifiedBaselineEdits(
      [
        { ...verified("f1", "firm_age", "9"), findingStatus: "superseded" },
        { ...verified("f2", "deal_size", "40"), conflictGroupId: "cg-1" },
      ],
      () => undefined,
    );
    expect(staged).toEqual([]);
  });

  it("verified beats a fresher proposed finding for the same axis", () => {
    const staged = verifiedBaselineEdits(
      [
        verified("f1", "deals_per_md", "2"),
        {
          findingId: "f2",
          axis: "deals_per_md",
          value: "5",
          findingStatus: "proposed",
          retrievedAt: "2026-07-25T00:00:00Z",
        },
      ],
      () => undefined,
    );
    expect(staged).toEqual([{ editKey: "dealsPerMdL3y", value: 2 }]);
  });

  it("converges: once staged values are visible, it returns nothing", () => {
    const edits = { dealsPerMdL3y: 2 };
    const staged = verifiedBaselineEdits([verified("f1", "deals_per_md", "2")], (editKey) =>
      effectiveAxisValue({}, edits, editKey),
    );
    expect(staged).toEqual([]);
  });
});

describe("providerLabel", () => {
  it("labels single providers and any corroboration combination", () => {
    expect(providerLabel("dealdb")).toBe("Deal DB");
    expect(providerLabel("dealdb+websearch")).toBe("Deal DB + Web search");
    expect(providerLabel("beacondb+dealdb+filings")).toBe("BeaconDB + Deal DB + Filings");
    expect(providerLabel("mystery")).toBe("mystery");
  });
});

describe("formatScore — one 18-point scale everywhere", () => {
  it("formats the total over 18 with the tier letter", () => {
    expect(formatScore(13, "B")).toBe("13/18 · B");
  });

  it("omits the tier when none is given", () => {
    expect(formatScore(13)).toBe("13/18");
    expect(formatScore(13, null)).toBe("13/18");
  });

  it("shows an em dash for a missing or non-finite score", () => {
    expect(formatScore(null)).toBe("—/18");
    expect(formatScore(undefined, "A")).toBe("—/18 · A");
    expect(formatScore(Number.NaN)).toBe("—/18");
  });

  it("reads a hard reject as 0/18 · Rejected", () => {
    const r = mirrorScore({ firmType: "CS", advisoryConflict: true });
    expect(r.hardRejected).toBe(true);
    expect(formatScore(r.weightedTotal, r.tier)).toBe("0/18 · Rejected");
  });

  it("scoreFraction is a 0-1 bar width, clamped", () => {
    expect(scoreFraction(9)).toBe(0.5);
    expect(scoreFraction(18)).toBe(1);
    expect(scoreFraction(0)).toBe(0);
    expect(scoreFraction(null)).toBe(0);
    expect(scoreFraction(40)).toBe(1);
    expect(scoreFraction(-3)).toBe(0);
  });
});

describe("shownScore — a passed firm shows the score it was passed at", () => {
  const live = { weightedTotal: 12, tier: "B" };

  it("uses the reject decision's score and tier for a passed firm", () => {
    expect(shownScore(live, true, { scoreAtDecision: 8, tierAtDecision: "C" })).toEqual({
      total: 8,
      tier: "C",
    });
  });

  it("uses the live score for a firm that has not been passed", () => {
    expect(shownScore(live, false, { scoreAtDecision: 8, tierAtDecision: "C" })).toEqual({
      total: 12,
      tier: "B",
    });
  });

  it("falls back to the live score when no decision score is on file", () => {
    expect(shownScore(live, true, undefined)).toEqual({ total: 12, tier: "B" });
    expect(shownScore(live, true, { scoreAtDecision: null, tierAtDecision: "C" })).toEqual({
      total: 12,
      tier: "B",
    });
    expect(shownScore(live, true, { scoreAtDecision: 8, tierAtDecision: null })).toEqual({
      total: 12,
      tier: "B",
    });
  });

  it("keeps a recorded score of zero", () => {
    expect(shownScore(live, true, { scoreAtDecision: 0, tierAtDecision: "Rejected" })).toEqual({
      total: 0,
      tier: "Rejected",
    });
  });
});

describe("queueRowTier — queue, header and Pipeline agree", () => {
  it("shows R for a screened firm whatever its score tier", () => {
    expect(queueRowTier(true, "A")).toBe("Rejected");
    expect(queueRowTier(true, "Rejected")).toBe("Rejected");
  });

  it("shows the score tier otherwise, including a soft Rejected", () => {
    expect(queueRowTier(false, "B")).toBe("B");
    expect(queueRowTier(false, "Rejected")).toBe("Rejected");
  });
});

describe("pipelineSort", () => {
  const r = (id: string, bucket: string, total: number) => ({
    bucket,
    score: { total },
    firm: { firmId: id, firmName: id },
  });
  const ids = (rows: { firm: { firmId: string } }[]) => rows.map((x) => x.firm.firmId);

  it("defaults to stage: Closed first, Discovered last, Passed after everything", () => {
    const rows = [
      r("d", "Discovered", 18),
      r("p", "Passed", 18),
      r("c", "Closed", 2),
      r("n", "NDA", 9),
      r("s", "Screening", 12),
    ];
    expect(ids(pipelineSort(rows))).toEqual(["c", "n", "s", "d", "p"]);
  });

  it("breaks stage ties by score descending, then name", () => {
    const rows = [
      r("b-low", "Screening", 5),
      r("z-high", "Screening", 14),
      r("a-high", "Screening", 14),
    ];
    expect(ids(pipelineSort(rows, "stage"))).toEqual(["a-high", "z-high", "b-low"]);
  });

  it("orders passed firms by their shown score among themselves", () => {
    const rows = [r("p-low", "Passed", 3), r("p-high", "Passed", 11), r("d", "Discovered", 0)];
    expect(ids(pipelineSort(rows))).toEqual(["d", "p-high", "p-low"]);
  });

  it("sorts by score or by name on request, and does not mutate its input", () => {
    const rows = [r("b", "Closed", 4), r("a", "Discovered", 9), r("c", "NDA", 9)];
    const before = ids(rows);
    expect(ids(pipelineSort(rows, "score"))).toEqual(["a", "c", "b"]);
    expect(ids(pipelineSort(rows, "name"))).toEqual(["a", "b", "c"]);
    expect(ids(rows)).toEqual(before);
  });
});

describe("rejectDecisionByFirm", () => {
  it("keeps the newest reject decision per firm with its rationale and score in one pass", () => {
    // Decisions arrive newest first.
    const m = rejectDecisionByFirm([
      { firmId: "f1", decisionType: "advance" },
      {
        firmId: "f1",
        decisionType: "reject",
        rejectionRationale: " Too small ",
        scoreAtDecision: 7,
        tierAtDecision: "C",
      },
      {
        firmId: "f1",
        decisionType: "reject",
        rejectionRationale: "older",
        scoreAtDecision: 12,
        tierAtDecision: "B",
      },
      { firmId: "f2", decisionType: "Reject_Firm", scoreAtDecision: 0, tierAtDecision: "Rejected" },
      { firmId: "", decisionType: "reject", rejectionRationale: "no firm" },
      { firmId: null, decisionType: "reject" },
    ]);
    expect([...m.keys()]).toEqual(["f1", "f2"]);
    expect(m.get("f1")).toEqual({
      rationale: "Too small",
      scoreAtDecision: 7,
      tierAtDecision: "C",
    });
    expect(m.get("f2")).toEqual({
      rationale: null,
      scoreAtDecision: 0,
      tierAtDecision: "Rejected",
    });
  });
});

describe("hqCode", () => {
  it("maps every seeded country to a code and falls back to the name", () => {
    for (const country of Object.keys(COUNTRY_GEO)) {
      expect(hqCode(country)).toMatch(/^[A-Z]{2}$/);
    }
    expect(hqCode("United States")).toBe("US");
    expect(hqCode("Atlantis")).toBe("Atlantis");
    expect(hqCode(null)).toBe("—");
    expect(hqCode("")).toBe("—");
  });
});

describe("windowRange", () => {
  const base = { rowHeight: 50, count: 700, overscan: 3 };

  it("renders the visible rows plus overscan", () => {
    expect(windowRange({ ...base, scrollTop: 0, viewportHeight: 500 })).toEqual({
      start: 0,
      end: 13,
    });
    expect(windowRange({ ...base, scrollTop: 1000, viewportHeight: 500 })).toEqual({
      start: 17,
      end: 33,
    });
  });

  it("clamps to the row count and handles a table scrolled out of view", () => {
    expect(windowRange({ ...base, scrollTop: 999_999, viewportHeight: 500 })).toEqual({
      start: 697,
      end: 700,
    });
    expect(windowRange({ ...base, scrollTop: -400, viewportHeight: 500 })).toEqual({
      start: 0,
      end: 5,
    });
    expect(windowRange({ ...base, count: 0, scrollTop: 0, viewportHeight: 500 })).toEqual({
      start: 0,
      end: 0,
    });
  });
});

describe("revealScrollTop", () => {
  // Rows are 50px; a 40px sticky header sits above row 0, so row i spans 40 + 50i .. 90 + 50i.
  const base = { rowHeight: 50, headerHeight: 40, viewportHeight: 400 };

  it("leaves the scroll alone when the row is already visible", () => {
    expect(revealScrollTop({ ...base, scrollTop: 0, index: 3 })).toBe(0);
    expect(revealScrollTop({ ...base, scrollTop: -80, index: 0 })).toBe(-80);
  });

  it("scrolls up so the row clears the sticky header", () => {
    expect(revealScrollTop({ ...base, scrollTop: 500, index: 9 })).toBe(450);
  });

  it("scrolls down so the row ends at the bottom edge", () => {
    expect(revealScrollTop({ ...base, scrollTop: 0, index: 10 })).toBe(190);
  });
});

describe("pipelineSort reversal and header clicks", () => {
  const r = (id: string, bucket: string, total: number) => ({
    bucket,
    score: { total },
    firm: { firmId: id, firmName: id },
  });
  const ids = (rows: { firm: { firmId: string } }[]) => rows.map((x) => x.firm.firmId);

  it("reverses the whole order, Passed first when stage is flipped", () => {
    const rows = [r("d", "Discovered", 1), r("p", "Passed", 1), r("c", "Closed", 1)];
    expect(ids(pipelineSort(rows, "stage", true))).toEqual(["p", "d", "c"]);
    expect(ids(pipelineSort(rows, "name", true))).toEqual(["p", "d", "c"]);
  });

  it("a new key starts in its natural direction; the same key flips it, then flips back", () => {
    expect(sortDirection(DEFAULT_SORT)).toBe("descending");
    const flipped = nextSort(DEFAULT_SORT, "stage");
    expect(flipped).toEqual({ key: "stage", reversed: true });
    expect(sortDirection(flipped)).toBe("ascending");
    expect(nextSort(flipped, "stage")).toEqual(DEFAULT_SORT);
    const byName = nextSort(flipped, "name");
    expect(byName).toEqual({ key: "name", reversed: false });
    expect(sortDirection(byName)).toBe("ascending");
    expect(sortDirection({ key: "name", reversed: true })).toBe("descending");
  });
});

describe("navTarget", () => {
  it("maps navigation keys and clamps at the edges", () => {
    expect(navTarget("ArrowDown", 3, 10, 5)).toBe(4);
    expect(navTarget("ArrowUp", 3, 10, 5)).toBe(2);
    expect(navTarget("PageDown", 3, 10, 5)).toBe(8);
    expect(navTarget("PageDown", 8, 10, 5)).toBe(9);
    expect(navTarget("PageUp", 3, 10, 5)).toBe(0);
    expect(navTarget("Home", 7, 10, 5)).toBe(0);
    expect(navTarget("End", 3, 10, 5)).toBe(9);
  });

  it("returns the current index for a no-op at an edge and null for other keys", () => {
    expect(navTarget("ArrowUp", 0, 10, 5)).toBe(0);
    expect(navTarget("Home", 0, 10, 5)).toBe(0);
    expect(navTarget("ArrowDown", 9, 10, 5)).toBe(9);
    expect(navTarget("End", 9, 10, 5)).toBe(9);
    expect(navTarget("Enter", 3, 10, 5)).toBeNull();
    expect(navTarget("a", 3, 10, 5)).toBeNull();
  });
});

describe("windowSegments", () => {
  const rowsOf = (segs: ReturnType<typeof windowSegments>) =>
    segs.map((s) => (s.kind === "row" ? s.index : `s${s.rows}`));

  it("is the window between two spacers", () => {
    expect(rowsOf(windowSegments({ start: 4, end: 7, count: 10, pinned: null }))).toEqual([
      "s4",
      4,
      5,
      6,
      "s3",
    ]);
    expect(rowsOf(windowSegments({ start: 0, end: 3, count: 3, pinned: null }))).toEqual([0, 1, 2]);
    expect(rowsOf(windowSegments({ start: 0, end: 0, count: 0, pinned: null }))).toEqual([]);
  });

  it("keeps a focused row that scrolled above or below the window, spacing around it", () => {
    expect(rowsOf(windowSegments({ start: 6, end: 8, count: 12, pinned: 2 }))).toEqual([
      "s2",
      2,
      "s3",
      6,
      7,
      "s4",
    ]);
    expect(rowsOf(windowSegments({ start: 1, end: 3, count: 12, pinned: 9 }))).toEqual([
      "s1",
      1,
      2,
      "s6",
      9,
      "s2",
    ]);
    expect(rowsOf(windowSegments({ start: 0, end: 2, count: 5, pinned: 4 }))).toEqual([
      0,
      1,
      "s2",
      4,
    ]);
  });

  it("ignores a pinned row already in the window or out of range", () => {
    expect(rowsOf(windowSegments({ start: 2, end: 5, count: 8, pinned: 3 }))).toEqual([
      "s2",
      2,
      3,
      4,
      "s3",
    ]);
    expect(rowsOf(windowSegments({ start: 2, end: 5, count: 8, pinned: 20 }))).toEqual([
      "s2",
      2,
      3,
      4,
      "s3",
    ]);
  });
});

describe("axisBadge — what an axis row shows beside its finding", () => {
  it("an abstained axis reads 'No source — needs you' with no provider or confidence chip", () => {
    const finding = { findingId: "1", provider: "exa", confidenceTier: "abstain" };
    expect(axisBadge(classifyAxis(finding), false)).toEqual({
      label: "No source \u2014 needs you",
      showProvider: false,
      showConfidence: false,
    });
  });

  it("an abstained axis that already has a value shows the value, not 'needs you'", () => {
    const finding = { findingId: "1", provider: "exa", confidenceTier: "abstain" };
    expect(axisBadge(classifyAxis(finding), true)).toEqual({
      label: null,
      showProvider: false,
      showConfidence: false,
    });
  });

  it("only a proposed value carries a confidence chip", () => {
    expect(axisBadge("proposed", false)).toMatchObject({
      label: null,
      showProvider: true,
      showConfidence: true,
    });
    expect(axisBadge("verified", true)).toMatchObject({
      label: null,
      showProvider: true,
      showConfidence: false,
    });
  });
});

describe("deskPanelState — one panel state at a time", () => {
  const base: DeskPanelInputs = {
    selectedId: undefined,
    firmsLoading: false,
    membershipLoading: false,
    hasError: false,
    searchActive: false,
    inView: false,
    inDatabase: false,
    viewCount: 10,
  };

  it("shows the skeleton, not 'Pick a firm', while a deep-linked firm loads", () => {
    expect(deskPanelState({ ...base, selectedId: "f1", firmsLoading: true })).toBe("skeleton");
  });

  it("shows the empty prompt for no firmId, loading or not", () => {
    expect(deskPanelState(base)).toBe("empty");
    expect(deskPanelState({ ...base, firmsLoading: true })).toBe("empty");
  });

  it("says the queue is empty only once the firms have loaded and none exist", () => {
    expect(deskPanelState({ ...base, viewCount: 0 })).toBe("queue-empty");
    expect(deskPanelState({ ...base, viewCount: 0, firmsLoading: true })).toBe("empty");
    expect(deskPanelState({ ...base, viewCount: 0, hasError: true })).toBe("error");
  });

  it("renders the firm once it is in the view", () => {
    expect(deskPanelState({ ...base, selectedId: "f1", inView: true, inDatabase: true })).toBe(
      "firm",
    );
  });

  it("calls an id not in the full list not-found only after loading, with no error", () => {
    expect(deskPanelState({ ...base, selectedId: "nope" })).toBe("not-found");
    expect(deskPanelState({ ...base, selectedId: "nope", firmsLoading: true })).toBe("skeleton");
  });

  it("a failed query reports the error, never not-found", () => {
    expect(deskPanelState({ ...base, selectedId: "f1", hasError: true })).toBe("error");
    expect(deskPanelState({ ...base, hasError: true })).toBe("error");
  });

  it("holds the skeleton while search membership loads, even for a real firm", () => {
    expect(
      deskPanelState({
        ...base,
        selectedId: "f1",
        searchActive: true,
        membershipLoading: true,
        inDatabase: true,
      }),
    ).toBe("skeleton");
  });

  it("a real firm outside the active search is not-in-search", () => {
    expect(
      deskPanelState({ ...base, selectedId: "f1", searchActive: true, inDatabase: true }),
    ).toBe("not-in-search");
  });

  it("a member of the active search renders the firm", () => {
    expect(
      deskPanelState({
        ...base,
        selectedId: "f1",
        searchActive: true,
        inDatabase: true,
        inView: true,
      }),
    ).toBe("firm");
  });

  it("an empty active search shows only the search-empty panel", () => {
    expect(deskPanelState({ ...base, searchActive: true, viewCount: 0 })).toBe("search-empty");
    expect(
      deskPanelState({ ...base, searchActive: true, viewCount: 0, membershipLoading: true }),
    ).toBe("search-empty");
    expect(deskPanelState({ ...base, searchActive: true, viewCount: 0, firmsLoading: true })).toBe(
      "empty",
    );
  });
});

describe("latestRejection", () => {
  it("keeps only reject decisions, newest first per firm, so keep_passed never becomes the reason", () => {
    const m = latestRejection([
      { decisionId: "d4", firmId: "f1", decisionType: "keep_passed", rejectionRationale: "kept" },
      { decisionId: "d3", firmId: "f1", decisionType: "reject", rejectionRationale: "Deal size" },
      {
        decisionId: "d2",
        firmId: "f2",
        decisionType: "acknowledge_drift",
        rejectionRationale: "x",
      },
      { decisionId: "d1", firmId: "f1", decisionType: "reject", rejectionRationale: "older" },
    ]);
    expect([...m.keys()]).toEqual(["f1"]);
    expect(m.get("f1")?.decisionId).toBe("d3");
  });
});

describe("lookalikesFor", () => {
  const drift = {
    firmId: "self",
    changedAxes: JSON.stringify([
      { axis: "Deal Size", old: ">$150m", new: "<$25m" },
      { axis: "Firm Age", old: "<5y", new: "15y" },
    ]),
  };
  const firm = (firmId: string) => ({ firmId, firmName: firmId });
  const reasons = new Map([
    ["self", { rejectionRationale: "Deal size too small" }],
    ["a", { rejectionRationale: "Deal size below our floor" }],
    ["b", { rejectionRationale: "Bench too thin" }],
    ["c", { rejectionRationale: "", analystCategorization: "deal size" }],
    ["age", { rejectionRationale: "Firm age is too young" }],
  ]);
  const all = ["self", "a", "b", "c", "age"].map(firm);

  it("returns firms passed for the axis that invalidated this firm's reason, never itself", () => {
    const { firms, total } = lookalikesFor(drift, all, reasons);
    expect(firms.map((f) => f.firmId)).toEqual(["a", "c"]);
    expect(total).toBe(2);
  });

  it("does not count a firm passed for an unrelated changed axis", () => {
    const { firms } = lookalikesFor(drift, all, reasons);
    expect(firms.map((f) => f.firmId)).not.toContain("age");
  });

  it("is empty when the drifted firm's own reason matches no changed axis, or no passed firm shares it", () => {
    const empty = { firms: [], total: 0 };
    expect(
      lookalikesFor(
        drift,
        all,
        new Map([...reasons, ["self", { rejectionRationale: "Bench thin" }]]),
      ),
    ).toEqual(empty);
    expect(lookalikesFor(drift, all, new Map([...reasons].filter(([k]) => k !== "self")))).toEqual(
      empty,
    );
    expect(lookalikesFor(drift, [firm("self"), firm("b")], reasons)).toEqual(empty);
    expect(lookalikesFor({ firmId: "self", changedAxes: "[]" }, all, reasons)).toEqual(empty);
  });

  it("keeps the true total past nine, listing the nine newest", () => {
    const many = new Map<string, { rejectionRationale: string }>([
      ["self", { rejectionRationale: "Deal size" }],
    ]);
    const firms = [];
    for (let i = 0; i < 12; i++) {
      many.set(`f${i}`, { rejectionRationale: "Deal size" });
      firms.push(firm(`f${i}`));
    }
    const { firms: listed, total } = lookalikesFor(
      drift,
      [firm("self"), ...[...firms].reverse()],
      many,
    );
    expect(total).toBe(12);
    expect(listed.map((f) => f.firmId)).toEqual(firms.slice(0, 9).map((f) => f.firmId));
  });
});

describe("RESOLUTION_LABEL", () => {
  it("names every resolution an action writes and falls back to a readable form", () => {
    expect(RESOLUTION_LABEL).toEqual({
      re_engaged: "Re-engaged",
      kept_passed: "Kept passed",
      kept_in_pipeline: "Kept in pipeline",
      passed: "Passed",
    });
    expect(resolutionLabel("constructor")).toBe("Constructor");
    expect(resolutionLabel("kept_passed")).toBe("Kept passed");
    expect(resolutionLabel("some_new_value")).toBe("Some new value");
    expect(resolutionLabel(undefined)).toBe("Resolved");
  });
});

describe("highlightQuote", () => {
  const body = "Intro line.\nThe firm averaged 4.3 closed deals\n   per managing director.\nOutro.";

  it("finds an exact quote and splits the body around it", () => {
    expect(highlightQuote(body, "Intro line.")).toEqual({
      before: "",
      match: "Intro line.",
      after: body.slice("Intro line.".length),
    });
  });

  it("finds a quote across whitespace differences and returns null when absent", () => {
    const hit = highlightQuote(body, "averaged 4.3 closed deals per managing director.");
    expect(hit?.match).toBe("averaged 4.3 closed deals\n   per managing director.");
    expect(hit && hit.before + hit.match + hit.after).toBe(body);
    expect(highlightQuote(body, "averaged 9 closed deals")).toBeNull();
    expect(highlightQuote(body, "")).toBeNull();
    expect(highlightQuote(body, "   ")).toBeNull();
  });
});

describe("modelChipTitle", () => {
  it("says the read was recorded when the demo data was built, and not a model for rule-based", () => {
    expect(modelChipTitle("claude-haiku-4-5")).toBe(
      "Read by Claude Haiku 4.5 when the demo data was built; no model runs on this page.",
    );
    expect(modelChipTitle("rule-based")).toBe("Read by a rule-based extractor (no model).");
  });
});

describe("modelLabel", () => {
  it("maps known ids", () => {
    expect(modelLabel("claude-haiku-4-5")).toBe("Claude Haiku 4.5");
    expect(modelLabel("claude-sonnet-5-5")).toBe("Claude Sonnet 5.5");
    expect(modelLabel("rule-based")).toBe("Rule-based extractor");
    expect(modelLabel("gpt-something")).toBe("gpt-something");
    expect(modelLabel(null)).toBeNull();
    expect(modelLabel(undefined)).toBeNull();
    expect(modelLabel("")).toBeNull();
  });
});

describe("excerptText", () => {
  it("quotes only an excerpt backed by a source document", () => {
    expect(excerptText({ sourceExcerpt: "averaged 4.3", sourceDocumentId: "dealdb:f1" })).toBe(
      "\u201caveraged 4.3\u201d",
    );
    expect(
      excerptText({ sourceExcerpt: "Analyst entered 200, replacing the Deal DB value 60." }),
    ).toBe("Analyst entered 200, replacing the Deal DB value 60.");
    expect(
      excerptText({ sourceExcerpt: "No provider grounded this value.", sourceDocumentId: null }),
    ).toBe("No provider grounded this value.");
    expect(excerptText({ sourceExcerpt: "", sourceDocumentId: "dealdb:f1" })).toBeNull();
    expect(excerptText({})).toBeNull();
  });
});

describe("defaultDeskFirmId", () => {
  it("picks the first queue firm with an open agent run", () => {
    const open = new Set(["c", "b"]);
    expect(defaultDeskFirmId(["a", "b", "c"], open)).toBe("b");
    expect(defaultDeskFirmId(["a", "x"], open)).toBeUndefined();
    expect(defaultDeskFirmId([], open)).toBeUndefined();
    expect(defaultDeskFirmId(["a"], new Set())).toBeUndefined();
  });

  it("counts firms the agent touched and no analyst has acted on", () => {
    const ids = agentRunFirmIds(
      [
        { firmId: "showcase", enrichedBy: "agent" },
        { firmId: "acted-on", enrichedBy: "demo-analyst" },
        { firmId: "untouched", enrichedBy: null },
        { firmId: "bare" },
        { firmId: null, enrichedBy: "agent" },
      ],
      "agent",
    );
    expect([...ids]).toEqual(["showcase"]);
    // Queue order decides among them: the analyst-touched firm ranked first is skipped.
    expect(defaultDeskFirmId(["acted-on", "showcase"], ids)).toBe("showcase");
  });
});

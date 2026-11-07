import { beforeAll, describe, expect, it } from "vitest";
import { firmModel } from "../../shared/scoring.js";
import { ENRICH_AXES, PROVIDER_TRUST } from "../../shared/vocab.js";
import { NO_WALL } from "../access.js";
import type { Db } from "../db/client.js";
import { listAll } from "../db/repo.js";
import { sameValue } from "../enrichment/reconcile.js";
import { EXTRACTION_PROMPT_VERSION } from "../extraction/contract.js";
import { documentsHash, firmDocuments } from "../extraction/documents.js";
import { resetDemo } from "../seed/reset.js";
import { createTestDb } from "../testing.js";
import { type FirmObservations, observeFirm } from "./firmObservations.js";
import { runFunction } from "./index.js";

const runFn = (db: Db, name: string, params: Record<string, unknown> = {}) =>
  runFunction(db, name, params, NO_WALL);

let db: Db;
let firmId: string;

const observationsFor = (id: string) =>
  runFn(db, "firmObservations", { firmId: id }) as Promise<FirmObservations>;

beforeAll(async () => {
  db = await createTestDb();
  await resetDemo(db, new Date("2026-09-22T12:00:00.000Z"));
  // A showcase firm: an open agent run with a conflict, a proposal and an abstention.
  const [row] = await db.query<{ firmId: string }>(
    `SELECT f."firmId"
       FROM firm f
      WHERE f."enrichedBy" = 'agent'
        AND EXISTS (SELECT 1 FROM research_finding r WHERE r."firmId" = f."firmId"
                      AND r."findingStatus" = 'proposed' AND r."conflictGroupId" IS NOT NULL)
        AND EXISTS (SELECT 1 FROM research_finding r WHERE r."firmId" = f."firmId"
                      AND r."findingStatus" = 'abstained')
      ORDER BY f."firmId" LIMIT 1`,
  );
  const pick = row?.firmId;
  expect(pick).toBeDefined();
  firmId = pick;
});

describe("firmObservations", () => {
  it("rejects a missing firmId with 400 and an unknown firm with 404", async () => {
    await expect(runFn(db, "firmObservations", {})).rejects.toMatchObject({ status: 400 });
    await expect(runFn(db, "firmObservations", { firmId: "" })).rejects.toMatchObject({
      status: 400,
    });
    await expect(observationsFor("no-such-firm")).rejects.toMatchObject({ status: 404 });
  });

  it("returns one entry per rubric axis and provider", async () => {
    const [firm] = await listAll(db, "Firm", { where: { firmId: { $eq: firmId } } });
    const obs = await observationsFor(firmId);
    const expected = ENRICH_AXES.filter((a) => a.models.includes(firmModel(firm))).map(
      (a) => a.axis,
    );
    expect(obs.firmId).toBe(firmId);
    expect(obs.axes.map((a) => a.axis)).toEqual(expected);
    for (const a of obs.axes) {
      expect(a.providers.map((p) => p.provider)).toEqual([...PROVIDER_TRUST]);
    }
    for (const p of PROVIDER_TRUST) {
      const grounded = obs.axes.filter(
        (a) => a.providers.find((x) => x.provider === p)?.grounded === true,
      ).length;
      expect(obs.hitsByProvider[p]).toBe(grounded);
    }
  });

  it("matches stored findings for the showcase firm", async () => {
    const obs = await observationsFor(firmId);
    const findings = (
      await listAll(db, "ResearchFinding", { where: { firmId: { $eq: firmId } } })
    ).filter((f) => f.findingStatus === "proposed" || f.findingStatus === "abstained");
    expect(findings.some((f) => f.findingStatus === "abstained")).toBe(true);
    let conflicts = 0;
    for (const { axis, providers } of obs.axes) {
      const def = ENRICH_AXES.find((a) => a.axis === axis);
      if (!def) {
        throw new Error(`unknown axis ${axis}`);
      }
      const keptValues = providers.flatMap((p) =>
        p.grounded && p.value !== null ? [p.value] : [],
      );
      const mine = findings.filter((f) => f.axis === axis);
      for (const f of mine) {
        if (f.findingStatus === "abstained") {
          expect(keptValues, `${axis} abstained`).toEqual([]);
        } else {
          expect(
            keptValues.some((v) => sameValue(def, v, f.value ?? "")),
            `${axis} proposed ${f.value}`,
          ).toBe(true);
        }
      }
      const groups = mine.filter((f) => f.conflictGroupId);
      if (groups.length > 0) {
        conflicts += 1;
        const distinct = keptValues.filter(
          (v, i) => keptValues.findIndex((w) => sameValue(def, v, w)) === i,
        );
        expect(distinct.length, `${axis} conflict`).toBeGreaterThanOrEqual(2);
      }
    }
    expect(conflicts).toBeGreaterThan(0);
  });

  it("checks agree with the quote", async () => {
    const obs = await observationsFor(firmId);
    const grounded = obs.axes.flatMap((a) => a.providers).filter((p) => p.grounded);
    expect(grounded.length).toBeGreaterThan(0);
    for (const p of grounded) {
      expect(p.quote).not.toBeNull();
      expect(p.checks?.words).toBeGreaterThanOrEqual(4);
      expect(p.checks?.valueInQuote).toBe(true);
      expect(p.checks?.line).not.toBeNull();
      expect(p.confidence === "high" || p.confidence === "low").toBe(true);
    }
    for (const p of obs.axes.flatMap((a) => a.providers).filter((x) => x.grounded === null)) {
      expect(p).toMatchObject({ value: null, quote: null, checks: null, confidence: null });
    }
  });
});

describe("observeFirm", () => {
  it("reports a stored answer grounding turned down, with why", async () => {
    const [firm] = await listAll(db, "Firm", { where: { firmId: { $eq: firmId } } });
    const docs = firmDocuments(firm);
    const doc = docs.find((d) => d.fields.some((f) => f.axis === "firm_age"));
    if (!doc) {
      throw new Error("no document states firm_age for this firm");
    }
    const row = {
      extractionId: "x1",
      firmId,
      provider: doc.provider,
      axis: "firm_age",
      value: "12",
      quote: "This sentence is not in the document at all.",
      model: "test-model",
      promptVersion: EXTRACTION_PROMPT_VERSION,
      documentsHash: documentsHash(docs),
    } as Parameters<typeof observeFirm>[1][number];
    const obs = observeFirm(firm, [row]);
    expect(obs.model).toBe("test-model");
    const cell = obs.axes
      .find((a) => a.axis === "firm_age")
      ?.providers.find((p) => p.provider === doc.provider);
    expect(cell).toMatchObject({
      value: "12",
      grounded: false,
      rejectReason: "quote_not_in_document",
      confidence: null,
      checks: null,
    });
    expect(obs.hitsByProvider[doc.provider]).toBe(0);
  });
});

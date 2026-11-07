/**
 * The information-barrier data the demo ships with, built last and deterministic:
 *  - three restricted firms, each with a reason only compliance sees;
 *  - need-to-know grants on every mandate: the deal lead and compliance hold all of them, the
 *    analyst all but one;
 *  - a codename on every mandate, and one extra mandate the analyst holds no grant on, so a
 *    switch to the analyst shows a title replaced by its codename.
 *
 * The restricted firms are plain, untouched firms: never one the history, the showcase or the
 * market signals gave any work, so nothing the tour or a test walks through depends on one.
 */
import { codenameFor } from "../../shared/accessPolicy.js";
import { applyAction } from "../actions/apply.js";
import type { Db } from "../db/client.js";
import { sortedRows } from "../db/ordering.js";
import { insertObjects, listAll, updateObject } from "../db/repo.js";

const DAY = 86_400_000;

/** How many firms the demo restricts. */
export const RESTRICTED_FIRM_COUNT = 3;

/** Plausible reasons, in the order the restricted firms are picked. Only compliance reads them. */
export const RESTRICTION_REASONS = [
  "Live mandate: firm advises a counterparty",
  "Conflict check pending: prior engagement with a mandate client",
  "Information barrier: holds inside information on a listed target",
] as const;

/** Days before the seed each restriction was added. */
const ADDED_DAYS_AGO = [6, 9, 12] as const;

/** The mandate the analyst has no grant on. Its real title is hidden from the analyst. */
export const WALLED_MANDATE = {
  title: "Confidential carve-out: regional wealth manager sell-side process",
  archetype: "CF",
  geographies: ["Americas"],
  priority: "High",
  codename: "Project Kestrel",
} as const;

/** Codenames for the mandates the history creates, in the order it creates them. */
const SEED_CODENAMES = ["Project Osprey", "Project Heron", "Project Merlin"] as const;

/** Who holds need-to-know on an ordinary mandate, and on the walled one. */
const OPEN_TO = ["analyst", "deal_lead", "compliance"] as const;
const WALLED_TO = ["deal_lead", "compliance"] as const;

function barrierIds(): (prefix: string) => string {
  let n = 0;
  return (prefix) => `${prefix}-seed-barrier-${String(++n).padStart(3, "0")}`;
}

/** Firms nothing else in the seed touched: still Discovered, never enriched, searched, decided or signalled. */
async function untouchedFirms(db: Db): Promise<string[]> {
  const rows = await db.query<{ firmId: string; employees: number | null }>(
    `SELECT f."firmId", f."employees" FROM firm f
      WHERE f."lifecycleState" = 'Discovered' AND f."enrichedBy" IS NULL
        AND f."discoveredViaSearchId" IS NULL
        AND NOT EXISTS (SELECT 1 FROM search_membership m WHERE m."firmId" = f."firmId")
        AND NOT EXISTS (SELECT 1 FROM research_finding x WHERE x."firmId" = f."firmId")
        AND NOT EXISTS (SELECT 1 FROM review_decision x WHERE x."firmId" = f."firmId")
        AND NOT EXISTS (SELECT 1 FROM drift_event x WHERE x."firmId" = f."firmId")
        AND NOT EXISTS (SELECT 1 FROM market_signal x WHERE x."firmId" = f."firmId")
        AND NOT EXISTS (SELECT 1 FROM qualification_score x WHERE x."firmId" = f."firmId")`,
  );
  // Larger firms first (more likely to advise a counterparty), then by id: the same three every run.
  return rows
    .sort(
      (a, b) =>
        (b.employees ?? 0) - (a.employees ?? 0) ||
        (a.firmId < b.firmId ? -1 : a.firmId > b.firmId ? 1 : 0),
    )
    .slice(0, RESTRICTED_FIRM_COUNT)
    .map((r) => r.firmId);
}

/**
 * Build the barrier data on a demo that has its history. Runs in the caller's transaction when
 * `db` joins one. `now` is the seed time.
 */
export async function seedBarriers(
  db: Db,
  now: Date,
): Promise<{ restricted: string[]; walledMandateId: string }> {
  // The walled mandate is made through the real action, dated before the history so it sorts last
  // and the mandates the screens already show keep their places.
  const made = await applyAction(
    db,
    "runMandateSearch",
    {
      title: WALLED_MANDATE.title,
      archetype: WALLED_MANDATE.archetype,
      geographies: [...WALLED_MANDATE.geographies],
      priority: WALLED_MANDATE.priority,
    },
    { now: new Date(now.getTime() - 31 * DAY), newId: barrierIds(), recordRun: null },
  );
  const walledMandateId = made.created![0];

  const mandates = sortedRows("Mandate", await listAll(db, "Mandate"), ["createdAt"]);
  const history = mandates.filter((m) => m.$primaryKey !== walledMandateId);
  const names = new Map<string, string>([
    ...history.map((m, i): [string, string] => [
      m.$primaryKey,
      SEED_CODENAMES[i] ?? codenameFor(m.$primaryKey),
    ]),
    [walledMandateId, WALLED_MANDATE.codename],
  ]);
  for (const [mandateId, codename] of names) {
    await updateObject(db, "Mandate", mandateId, { codename });
  }
  await insertObjects(
    db,
    "MandateAccess",
    mandates.flatMap((m) =>
      (m.$primaryKey === walledMandateId ? WALLED_TO : OPEN_TO).map((persona) => ({
        accessId: `access:${m.$primaryKey}:${persona}`,
        mandateId: m.$primaryKey,
        persona,
      })),
    ),
  );

  const restricted = await untouchedFirms(db);
  await insertObjects(
    db,
    "RestrictedFirm",
    restricted.map((firmId, i) => ({
      firmId,
      reason: RESTRICTION_REASONS[i % RESTRICTION_REASONS.length],
      addedAt: new Date(
        now.getTime() - ADDED_DAYS_AGO[i % ADDED_DAYS_AGO.length] * DAY,
      ).toISOString(),
    })),
  );
  return { restricted, walledMandateId };
}

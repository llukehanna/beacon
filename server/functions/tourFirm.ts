/**
 * The firm the guided tour's Desk stops open on. The demo is shared and visitors can pass a firm,
 * qualify it or resolve its conflict, any of which would leave the tour pointing at a decision bar
 * that is gone or a conflict that no longer exists. So the tour asks for its firm each time: the
 * first showcase firm the persona can see that is still undecided and still has an open conflict.
 */
import { STRONG_SHOWCASE_FIRM_IDS, TOUR_FIRM_ID } from "../../shared/showcaseFirms.js";
import type { TourFirm } from "../../shared/summaries.js";
import { PASSED, isQualifiedOrLater, normalizeLifecycle } from "../../shared/vocab.js";
import type { Access } from "../access.js";
import type { Queryable } from "../db/client.js";

interface Candidate {
  firmId: string;
  lifecycleState: string | null;
  currentStage: string | null;
  openConflict: boolean;
}

/** Passed, or qualified and beyond: the Desk no longer offers the decision the tour points at. */
function decided(c: Candidate): boolean {
  return [c.lifecycleState, c.currentStage].some((raw) => {
    const state = normalizeLifecycle(raw);
    return state === PASSED || isQualifiedOrLater(state);
  });
}

/**
 * The first showcase firm that is undecided with an open conflict (two findings in a conflict group
 * still proposed); else the first undecided one; else the seeded tour firm, so the tour always has
 * somewhere to go. Showcase firms hidden from the persona are never chosen.
 */
export async function tourFirm(q: Queryable, access: Access): Promise<TourFirm> {
  const hidden = new Set(access.hiddenFirmIds);
  const ids = STRONG_SHOWCASE_FIRM_IDS.filter((id) => !hidden.has(id));
  const rows = await q.query<Candidate>(
    `SELECT f."firmId", f."lifecycleState", f."currentStage",
            EXISTS (
              SELECT 1 FROM research_finding r
               WHERE r."firmId" = f."firmId"
                 AND coalesce(r."conflictGroupId", '') <> ''
                 AND lower(coalesce(r."findingStatus", '')) = 'proposed'
               GROUP BY r."conflictGroupId"
              HAVING count(*) >= 2
            ) AS "openConflict"
       FROM firm f
      WHERE f."firmId" = ANY($1::text[])`,
    [ids],
  );
  const byId = new Map(rows.map((r) => [r.firmId, r]));
  const candidates = ids.flatMap((id) => byId.get(id) ?? []);
  const open = candidates.filter((c) => !decided(c));
  const pick = open.find((c) => c.openConflict) ?? open[0];
  return { firmId: pick?.firmId ?? TOUR_FIRM_ID };
}

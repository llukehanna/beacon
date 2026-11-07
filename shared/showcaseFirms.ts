/**
 * The firms the seed leaves with a nearly complete agent run: most axes carry a cited value, one
 * axis has two sources in conflict and one or two abstain, and verifying the proposed values would
 * put the firm in tier B or better. They were chosen from firms whose recorded extractions are rich,
 * and the seed test checks that each still fits. The guided tour opens the first on the Desk.
 */
export const STRONG_SHOWCASE_FIRM_IDS = [
  "mallowickpartners_unitedstates",
  "northcottogilvie_unitedstates",
  "dunmoreadvisors_unitedstates",
] as const;

/** The firm the tour's Desk stops open on. */
export const TOUR_FIRM_ID: string = STRONG_SHOWCASE_FIRM_IDS[0];

# Error analysis

Where Beacon's agent ends without the true value, why, and what Beacon does about each case.

Every number here is read from [evals.json](evals.json), which `npm run eval` regenerates from the generated universe's hidden truth and the committed extraction recordings (see [evals.md](evals.md)). All of them are measured against synthetic ground truth: they say how the pipeline behaves on this generated data, not how it would behave on real firms. `server/trustClaims.test.ts` fails if the counts or examples here disagree with the JSON.

## The taxonomy

The agent enriches 7,079 firm axes (700 firms, each axis its model scores). 4,505 of them (63.6%) end with the true value settled. Each of the other 2,574 is in exactly one of four kinds, by what the agent recorded.

| Kind | Axes | Share of axes | What happened |
| --- | --- | --- | --- |
| A wrong value was settled (`wrong-source-wins`) | 329 | 4.6% | The agent settled on a value that is not the truth. Reconciliation settles only when the readings it kept agree, so a wrong value reaches the record when one source's error stands alone or every source repeats it. |
| Sources disagreed (`conflict-surfaced`) | 141 | 2.0% | Two sources gave different values. The agent recorded both positions, ordered by provider trust, and picked no winner. |
| No source had it (`abstained-correctly`) | 2,104 | 29.7% | No source's record stated the axis, so the agent recorded no value. |
| A value was lost (`abstained-wrongly`) | 0 | 0.0% | A record stated the axis but no value survived extraction and grounding. |

The universe has no time dimension, so there is no "stale value" kind: a source is wrong or right, never out of date.

## Examples

Each links to the firm on the Desk of the live demo. Examples are the first firms in universe order, each from a different firm.

**A wrong value was settled**

- [`merriweatherfairbairnwinslow_unitedkingdom`, web_activity](https://beacon.lukeghanna.com/desk?firmId=merriweatherfairbairnwinslow_unitedkingdom)
- [`zephyrleasecurities_australia`, md_pedigree](https://beacon.lukeghanna.com/desk?firmId=zephyrleasecurities_australia)
- [`rosalescallowaylindqvistpartners_unitedstates`, md_pedigree](https://beacon.lukeghanna.com/desk?firmId=rosalescallowaylindqvistpartners_unitedstates)

**Sources disagreed**

- [`merriweatherfairbairnwinslow_unitedkingdom`, md_pedigree](https://beacon.lukeghanna.com/desk?firmId=merriweatherfairbairnwinslow_unitedkingdom)
- [`penroseeskerabernathy_unitedstates`, fee_generating_count](https://beacon.lukeghanna.com/desk?firmId=penroseeskerabernathy_unitedstates)
- [`stonewickgroup_japan`, deals_per_md_l3y](https://beacon.lukeghanna.com/desk?firmId=stonewickgroup_japan)

**No source had it**

- [`merriweatherfairbairnwinslow_unitedkingdom`, deals_per_md_l3y](https://beacon.lukeghanna.com/desk?firmId=merriweatherfairbairnwinslow_unitedkingdom)
- [`kowalskicapitalpartners_unitedkingdom`, deal_size_usd_m](https://beacon.lukeghanna.com/desk?firmId=kowalskicapitalpartners_unitedkingdom)
- [`eastwickbrandtiverson_unitedstates`, md_pedigree](https://beacon.lukeghanna.com/desk?firmId=eastwickbrandtiverson_unitedstates)

**A value was lost.** None in the recorded run.

## What Beacon does about each

**Provider trust order (BeaconDB, Deal DB, Filings, Web search).** It decides which position leads when sources disagree, and which two positions are shown when more than two exist. Of the 141 conflicts, the more trusted source matched the truth in 90.8% (`reconciled.higherTrustRight`). That is a good tiebreak and still wrong in the other 9.2%, which is why the order never settles a conflict on its own. Web search is the weakest source, at 82.3% precision against 98.5% for BeaconDB, and it is last in the order.

**Abstention.** When no source supplies a value the agent records that, instead of guessing. 2,104 axes (29.7%) ended this way, and 100% of abstentions were justified (`abstention.calibration`): none had a record that stated the value. The grounding check, which keeps only values the record's own quoted sentence contains, is why no value was lost (0 `abstained-wrongly`). The harness cannot say how many wrong values a guess would have added, because the agent never guesses.

**Conflicts surfaced to the analyst.** The 141 conflicts (2.8% of axes that had any reading, `reconciled.conflictRate`) are handed to the analyst with both quotes and sources rather than settled. This is where review time goes: the analyst decides, and the other position is marked rejected. What review cannot yet catch is the first row of the taxonomy. The 329 wrong values settled are 6.8% of settled values (reconciled precision is 93.2%), and each carries its source and quote for the analyst, who is the only check on it. The harness does not break these down by provider or confidence.

**Approved rules.** Analyst rejections that share a pattern are proposed as screening rules, and an approved rule then screens matching firms out as a hard screen. The harness plants the seed's rejection patterns and checks that the heuristic clusterer finds them: 4 of 4 (`ruleRecovery`). That checks the loop end to end. It does not measure how many bad extractions a rule prevents, so the taxonomy above does not change when a rule is approved.

## Reproduce

```
npm run eval            # regenerate evals.json, evals.md and the numbers above
npm run eval -- --check # fail if a threshold is missed or the committed files are stale
```

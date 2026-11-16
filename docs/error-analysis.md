# Error analysis

Where Beacon's agent ends without the true value, why, and what Beacon does about each case.

Every number here is read from [evals.json](evals.json), which `npm run eval` regenerates from the generated universe's hidden truth and the committed extraction recordings (see [evals.md](evals.md)). All of them are measured against synthetic ground truth: they say how the pipeline behaves on this generated data, not how it would behave on real firms. `server/trustClaims.test.ts` fails if the counts or examples here disagree with the JSON.

## The taxonomy

The agent enriches 7,079 firm axes (700 firms, each axis its model scores). 4,534 of them (64.0%) end with the true value settled. Each of the other 2,545 is in exactly one of four kinds, by what the agent recorded.

| Kind | Axes | Share of axes | What happened |
| --- | --- | --- | --- |
| A wrong value was settled (`wrong-source-wins`) | 327 | 4.6% | The agent settled on a value that is not the truth. Reconciliation settles only when the readings it kept agree, so a wrong value reaches the record when one source's error stands alone or every source repeats it. |
| Sources disagreed (`conflict-surfaced`) | 82 | 1.2% | Two sources gave different values. The agent recorded both positions, ordered by provider trust, and picked no winner. |
| No source had it (`abstained-correctly`) | 2,104 | 29.7% | No source's record stated the axis, so the agent recorded no value. |
| A value was lost (`abstained-wrongly`) | 32 | 0.5% | A record stated the axis but no value survived extraction and grounding. |

The universe has no time dimension, so there is no "stale value" kind: a source is wrong or right, never out of date.

## Examples

Each links to the firm on the Desk of the live demo. Examples are the first firms in universe order, each from a different firm.

**A wrong value was settled**

- [`gillardsackville_unitedkingdom`, web_activity](https://beacon.lukeghanna.com/desk?firmId=gillardsackville_unitedkingdom)
- [`saxenagroup_australia`, md_pedigree](https://beacon.lukeghanna.com/desk?firmId=saxenagroup_australia)
- [`melvillewadsworthadvisors_unitedstates`, md_pedigree](https://beacon.lukeghanna.com/desk?firmId=melvillewadsworthadvisors_unitedstates)

**Sources disagreed**

- [`ulrichsalterpartners_unitedstates`, firm_age](https://beacon.lukeghanna.com/desk?firmId=ulrichsalterpartners_unitedstates)
- [`dalrymplepartners_japan`, deals_per_md_l3y](https://beacon.lukeghanna.com/desk?firmId=dalrymplepartners_japan)
- [`sharlandsturgessadvisory_singapore`, md_pedigree](https://beacon.lukeghanna.com/desk?firmId=sharlandsturgessadvisory_singapore)

**No source had it**

- [`gillardsackville_unitedkingdom`, deals_per_md_l3y](https://beacon.lukeghanna.com/desk?firmId=gillardsackville_unitedkingdom)
- [`bassettlarkin_unitedkingdom`, deal_size_usd_m](https://beacon.lukeghanna.com/desk?firmId=bassettlarkin_unitedkingdom)
- [`slatermerchantpartners_unitedstates`, md_pedigree](https://beacon.lukeghanna.com/desk?firmId=slatermerchantpartners_unitedstates)

**A value was lost**

- [`ferrersadvisory_unitedstates`, services_fit](https://beacon.lukeghanna.com/desk?firmId=ferrersadvisory_unitedstates)
- [`carrowpartners_unitedstates`, has_st_or_balance_sheet](https://beacon.lukeghanna.com/desk?firmId=carrowpartners_unitedstates)
- [`musgravemeredithsouthallpartnersllc_unitedstates`, firm_age](https://beacon.lukeghanna.com/desk?firmId=musgravemeredithsouthallpartnersllc_unitedstates)

## What Beacon does about each

**Provider trust order (BeaconDB, Deal DB, Filings, Web search).** It decides which position leads when sources disagree, and which two positions are shown when more than two exist. Of the 82 conflicts, the more trusted source matched the truth in 86.6% (`reconciled.higherTrustRight`). That is a good tiebreak and still wrong in the other 13.4%, which is why the order never settles a conflict on its own. Web search is the weakest source, at 81.1% precision against 98.5% for BeaconDB, and it is last in the order.

**Abstention.** When no source supplies a value the agent records that, instead of guessing. 2,136 axes (30.2%) ended this way (`abstention.rate`): 2,104 where no record stated the axis, and 32 where a record did but no value survived. 98.5% of abstentions were justified (`abstention.calibration`), meaning no provider's record stated the value. The other 1.5% are the 32 lost values, the first failure the old fixtures did not have. The harness cannot say how many wrong values a guess would have added, because the agent never guesses.

**Why values were lost.** The grounding check requires the value to appear in the quote the model gives for it. The Web search source's `web_activity` answer is a true/false answer about whether the firm is active. In this run the model often quoted a trade-press line, such as a headline saying the firm "advises on the sale of" a company, as proof of activity, instead of a sentence that states the value. The check rejects those quotes, correctly, because the quote does not say the value. The 295 answers the grounding check dropped are almost all this kind: 266 are these `web_activity` answers; the other 29 are scattered across filings and Deal DB axes. The axis then rests on the other sources, and counts as "A value was lost" only when no source's reading survived.

**Conflicts surfaced to the analyst.** The 82 conflicts (1.7% of axes that had any reading, `reconciled.conflictRate`) are handed to the analyst with both quotes and sources rather than settled. This is where review time goes: the analyst decides, and the other position is marked rejected. What review cannot yet catch is the first row of the taxonomy. The 327 wrong values settled are 6.7% of settled values (reconciled precision is 93.3%), and each carries its source and quote for the analyst, who is the only check on it. The harness does not break these down by provider or confidence.

**Approved rules.** Analyst rejections that share a pattern are proposed as screening rules, and an approved rule then screens matching firms out as a hard screen. The harness plants the seed's rejection patterns and checks that the heuristic clusterer finds them: 4 of 4 (`ruleRecovery`). That checks the loop end to end. It does not measure how many bad extractions a rule prevents, so the taxonomy above does not change when a rule is approved.

## Reproduce

```
npm run eval            # regenerate evals.json, evals.md and the numbers above
npm run eval -- --check # fail if a threshold is missed or the committed files are stale
```

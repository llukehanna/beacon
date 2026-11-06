# 0002. Claude extraction with a grounding check, recorded offline

Status: Accepted

## Context

The enrichment agent has to turn a firm's source records (free text) into values for rubric axes. A model does that well, but two problems follow. A model answer can be wrong or invented, and an analyst cannot act on a value they cannot trace. And a live model call per click would make the public demo cost money per visitor and give different answers each time.

## Decision

Claude reads the records, but an answer is only kept if it can be traced to the text, and the reading happens once, offline.

- **Contract.** One pure module holds the prompt, the input and the output schema: per provider and axis, a value and the sentence it came from, or nothing (`server/extraction/contract.ts`, prompt version `extract-v1`).
- **Grounding.** An answer is kept only if the provider covers the axis, the value is valid for the axis, the quote appears word for word in the record (ignoring whitespace) and is at least a short sentence, and the quote contains the value. This holds for labels, numbers (as whole tokens) and true/false answers (`server/extraction/grounding.ts`). A rejected answer is dropped.
- **Offline recording.** `npm run extract` sends every firm through the Message Batches API (Claude Haiku 4.5) with a dollar cap, and writes one fixture line per firm with tokens, cost and latency (`fixtures/extraction/claude-haiku-4-5.jsonl`). The seed loads them as `Extraction` objects, and the **Run agent** button grounds the stored answers again, so no visitor action calls a model.
- **Staleness.** A stored answer is used only when its record hash and prompt version match the current code. Otherwise the firm falls back to a rule-based extractor that returns the same shape.
- **Recorded run.** All 700 firms; 6,455 of 6,472 values passed grounding (recomputed in `docs/evals.json`); the run cost $1.39 (stated in `docs/architecture.md` and `src/about/facts.ts`, `RECORDED_RUN`).

## Consequences

- Visitors spend nothing, the demo is reproducible, CI needs no API key, and the same fixtures feed the evaluation.
- The grounding rate shows that an answer quotes its record faithfully. It does not show the value is true: the records carry deliberate errors, which reconciliation and analyst review handle (the evaluation scores them against the generated truth).
- Changing the prompt or the record text makes the fixtures stale until `npm run extract` is run again, and the seed prints how many were current.
- The one live model call in the app is rule clustering, behind a flag and a daily cap (see [0007](0007-human-approval-before-rules-apply.md)).

## Code

`server/extraction/` (`contract.ts`, `grounding.ts`, `documents.ts`, `fixtures.ts`, `plan.ts`, `pricing.ts`), `scripts/extract.ts`. See [architecture.md](../architecture.md#the-enrichment-agent) and [evals.md](../evals.md).

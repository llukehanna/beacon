# Development history

Beacon was first built on Palantir Foundry: an ontology, Functions, Actions, an AIP clustering function and an OSDK-backed React app. When that environment went away, the backend was rebuilt on an open stack (Postgres, TypeScript, Cloudflare Workers) behind the same frontend. That port started in a fresh repository, so this repository's history begins at the open-stack version. The earlier Foundry-era history lives in a private archive. [foundry-origins.md](foundry-origins.md) maps each Foundry concept to what replaced it.

What follows is the public history, with dates taken from this repository's commits and merged pull requests. Each entry says what changed in the product.

## Port and first deployment

- **2026-09-24: open-stack port.** The first commit is the workbench on an open stack: mandate search, enrichment desk, deterministic scoring, pass rationales and rule proposals, drift review. The live demo link moves to `beacon.lukeghanna.com`.
- **2026-10-05: Workers and snapshot reset.** The demo is served from Cloudflare Workers, and a reset restores a saved snapshot instead of rebuilding the world. These commits keep the dates they were written on.
- **2026-11-03: Cloudflare and Neon deployment, public repository.** The app is deployed on Cloudflare Workers with Neon Postgres, and the repository is made public with CI.

## 2026-11-03: foundation and credibility fixes

Seven pull requests (#1 to #7) land on the day the repository goes public.

- **Workers sync, CI and reseed (#1, #2).** The Cloudflare Workers deployment lands on the main branch; CI and a manual reseed workflow are added.
- **Hardened HTTP layer (#3).** JSON-only bodies with a size cap, same-origin checks, security headers, per-IP rate limits, Smart Placement and a Hyperdrive-ready database connection. The Claude clustering call moves outside the database transaction.
- **Data model (#4).** A realistic deal funnel replaces the earlier lifecycle. Firms get revenue band, ownership and succession risk, and generated names that read like real partnerships.
- **Performance (#5).** Route pages are code-split, and Home and Accuracy read server-computed summaries.
- **UI credibility (#6).** One score scale (13/18 and a tier) everywhere, a windowed pipeline table, drift lookalikes drawn from real rejections only, and a Rules page that shows the analysts' notes behind each proposal.
- **Truthful copy and schema evolution (#7).** Documentation and in-app wording are corrected to match the code, and schema changes add missing columns instead of locking tables.

## 2026-11-04: grounded extraction and the showcase seed

- **Core grounding (#10).** Deterministic mock source records per provider, an extraction contract (the prompt, input and output schema), a grounding check, and an agent that cites the record and the exact quote behind every value.
- **Offline extraction and fixtures (#11).** `npm run extract` reads every firm's records through Claude's Message Batches API, with a dollar cap, resumable batches and crash-safe fixtures. The seed loads recorded answers, and twelve showcase firms are left with open agent runs so the desk opens on a live conflict.
- **Source drawer (#12).** The desk opens a source record with the cited quote highlighted.
- **Docs and wording (#13).** The architecture document, object and action counts, and abstention and model copy are brought in line with the code.
- **Smaller changes (#8, #9).** The content security policy allows Cloudflare Web Analytics, and the screenshots are retaken after the reseed.

## 2026-11-05: UI rebuild on a new design system

- **Facelift (#14).** A design-token system with Geist fonts and core components, then every screen rebuilt on it: a layout with sidebar, status bar and command palette, Home, the desk (queue, firm header, axis-by-source grid, evidence panel, decision bar), pipeline, review, rules, accuracy, mandates and search. A Playwright end-to-end suite is added alongside. Contrast is raised to AA, and navigation buttons render as real links.

## 2026-11-06: recorded Claude extraction and rule timestamps

- **Rule proposal timestamps (#15).** A proposed rule is stamped with the time it was created.
- **Recorded Claude Haiku 4.5 extraction for all 700 firms (#16).** The committed fixtures now come from a real run rather than the rule-based extractor. Of 6,472 extracted values, 6,471 passed the grounding check, at a cost of $1.39 (#17 records the run in the architecture document; #18 retakes the screenshots from the Claude-extracted demo).
- **Explaining the product.** A home-page introduction and a six-stop guided tour that never writes data, About and Trust pages, search filters pre-filled from the mandate text, and this history and the [production roadmap](production-roadmap.md).

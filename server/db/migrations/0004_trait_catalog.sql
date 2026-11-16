-- Traits and the rubric become data (ADR 0011).
--
-- trait   One row per trait a workspace knows about a firm: its kind (category, number, yesno),
--         its role (evidence, fact, profile), its vocabulary and display label, in catalog order.
-- rubric  One row per published rubric version: the whole definition as one JSON document, so a
--         score can cite an exact, immutable rule set. Append-only: a version is never rewritten
--         or deleted; only "active" may change, and one version per workspace is active.
--
-- The seed writes both, and this migration writes the current ones. Firms still store their trait values as columns; the API derives a
-- `traits` map from them until a later migration moves the values into their own table.

CREATE TABLE IF NOT EXISTS trait (
  "traitId" text PRIMARY KEY,
  "workspaceKey" text NOT NULL,
  "traitKey" text NOT NULL,
  "label" text NOT NULL,
  "description" text,
  "unit" text,
  "kind" text NOT NULL,
  "role" text NOT NULL,
  "optionsJson" text,
  "passWhen" boolean,
  "position" integer NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS trait_workspace_key ON trait ("workspaceKey", "traitKey");

CREATE TABLE IF NOT EXISTS rubric (
  "rubricId" text PRIMARY KEY,
  "workspaceKey" text NOT NULL,
  "version" integer NOT NULL,
  "name" text NOT NULL,
  "active" boolean NOT NULL,
  "definitionJson" text NOT NULL,
  "createdBy" text NOT NULL,
  "createdAt" timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS rubric_one_active ON rubric ("workspaceKey") WHERE "active";
CREATE UNIQUE INDEX IF NOT EXISTS rubric_workspace_version ON rubric ("workspaceKey", "version");

CREATE OR REPLACE FUNCTION rubric_append_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  mutable constant text[] := ARRAY['active'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'rubric is append-only' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'rubric is append-only: only active may change'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS rubric_append_only ON rubric;
CREATE TRIGGER rubric_append_only BEFORE UPDATE OR DELETE ON rubric
  FOR EACH ROW EXECUTE FUNCTION rubric_append_only();

-- The advisory-acquisitions catalog and rubric v1, frozen here so a migrated database scores before
-- the next reseed. A later change to the workspace is a new rubric version, never an edit here.
INSERT INTO trait ("traitId", "workspaceKey", "traitKey", "label", "description", "unit", "kind", "role", "optionsJson", "passWhen", "position") VALUES
  ('advisory-acquisitions:services_fit', 'advisory-acquisitions', 'services_fit', 'Services fit', 'Service offering', NULL, 'category', 'evidence', '["Conflicted: trading, lending or research","Adjacent advisory services","Full advisory suite","No private-capital products","Some private-capital products","Full private-capital suite"]', NULL, 0),
  ('advisory-acquisitions:md_pedigree', 'advisory-acquisitions', 'md_pedigree', 'MD pedigree', 'Managing directors'' backgrounds', NULL, 'category', 'evidence', '["Operator / non-finance backgrounds","Mixed: industry or boutique banking","Bulge-bracket or elite-boutique alumni","Non-finance backgrounds","Some credit or banking experience","Senior credit / capital-markets pedigree"]', NULL, 1),
  ('advisory-acquisitions:balance_sheet_principal', 'advisory-acquisitions', 'balance_sheet_principal', 'Balance sheet / principal', 'Principal / balance-sheet activity', NULL, 'category', 'evidence', '["Invests its own balance sheet","Occasional co-investment","Advisory only"]', NULL, 2),
  ('advisory-acquisitions:deal_size_usd_m', 'advisory-acquisitions', 'deal_size_usd_m', 'Avg deal size', 'Typical deal size, in US$ millions', '$m USD', 'number', 'evidence', NULL, NULL, 3),
  ('advisory-acquisitions:deals_per_md_l3y', 'advisory-acquisitions', 'deals_per_md_l3y', 'Deals per MD (last 3 years)', 'Closed deals per managing director per year, last three years', 'per MD, last 3 years', 'number', 'evidence', NULL, NULL, 4),
  ('advisory-acquisitions:firm_age', 'advisory-acquisitions', 'firm_age', 'Firm age', 'Firm age, in years', 'yrs', 'number', 'evidence', NULL, NULL, 5),
  ('advisory-acquisitions:fee_generating_count', 'advisory-acquisitions', 'fee_generating_count', 'Fee-earning heads', 'Number of fee-generating professionals', 'MDs', 'number', 'evidence', NULL, NULL, 6),
  ('advisory-acquisitions:advisory_conflict', 'advisory-acquisitions', 'advisory_conflict', 'Advisory conflict', 'Has a conflicting advisory relationship', NULL, 'yesno', 'evidence', NULL, false, 7),
  ('advisory-acquisitions:has_st_or_balance_sheet', 'advisory-acquisitions', 'has_st_or_balance_sheet', 'Sales & trading / balance sheet', 'Runs a sales-and-trading desk or a balance sheet', NULL, 'yesno', 'evidence', NULL, false, 8),
  ('advisory-acquisitions:web_activity', 'advisory-acquisitions', 'web_activity', 'Web activity', 'Shows recent public web activity', NULL, 'yesno', 'evidence', NULL, true, 9),
  ('advisory-acquisitions:solvent', 'advisory-acquisitions', 'solvent', 'Solvent', 'Is solvent', NULL, 'yesno', 'evidence', NULL, true, 10),
  ('advisory-acquisitions:coverage_model', 'advisory-acquisitions', 'coverage_model', 'Sector coverage', 'How many sectors the firm covers', NULL, 'category', 'fact', '["Generalist","Multi-sector","Single-sector focus"]', NULL, 11),
  ('advisory-acquisitions:geo_score', 'advisory-acquisitions', 'geo_score', 'Geographic fit', 'Fit of the firm''s headquarters geography, 0 to 2', NULL, 'number', 'fact', NULL, NULL, 12),
  ('advisory-acquisitions:employees', 'advisory-acquisitions', 'employees', 'Headcount', 'Total employees', 'people', 'number', 'fact', NULL, NULL, 13),
  ('advisory-acquisitions:revenue_band', 'advisory-acquisitions', 'revenue_band', 'Revenue band', 'Annual revenue band', NULL, 'category', 'profile', '["<$10M","$10–25M","$25–50M","$50–100M",">$100M"]', NULL, 14),
  ('advisory-acquisitions:ownership', 'advisory-acquisitions', 'ownership', 'Ownership', 'Who owns the firm', NULL, 'category', 'profile', '["Founder-owned","Partnership","PE-backed","Subsidiary"]', NULL, 15),
  ('advisory-acquisitions:succession_risk', 'advisory-acquisitions', 'succession_risk', 'Succession risk', 'How exposed the firm is to a leadership transition', NULL, 'category', 'profile', '["Low","Medium","High"]', NULL, 16)
ON CONFLICT ("traitId") DO NOTHING;

INSERT INTO rubric ("rubricId", "workspaceKey", "version", "name", "active", "definitionJson", "createdBy", "createdAt") VALUES
  ('advisory-acquisitions@1', 'advisory-acquisitions', 1, 'Advisory acquisitions rubric v1', true, $rubric${"defaultThesis":"CF","theses":[{"key":"CF","label":"Corporate finance","productGroups":["Corporate Finance"],"criteria":[{"traitKey":"coverage_model","label":"Coverage Model","weight":1,"scoring":{"type":"category","options":[{"value":"Generalist","points":0},{"value":"Multi-sector","points":1},{"value":"Single-sector focus","points":2}]}},{"traitKey":"services_fit","label":"Services","weight":1,"scoring":{"type":"category","options":[{"value":"Conflicted: trading, lending or research","points":0},{"value":"Adjacent advisory services","points":1},{"value":"Full advisory suite","points":2}]}},{"traitKey":"md_pedigree","label":"MD Experience","weight":1,"scoring":{"type":"category","options":[{"value":"Operator / non-finance backgrounds","points":0},{"value":"Mixed: industry or boutique banking","points":1},{"value":"Bulge-bracket or elite-boutique alumni","points":2}]}},{"traitKey":"geo_score","label":"Geographic Footprint","weight":1,"scoring":{"type":"direct","min":0,"max":2}},{"traitKey":"deal_size_usd_m","label":"Deal Size","weight":1,"scoring":{"type":"bands","bands":[{"max":25,"minInclusive":true,"maxInclusive":false,"points":0,"label":"<$25m"},{"min":25,"max":150,"minInclusive":true,"maxInclusive":true,"points":1,"label":"$25m-$150m"},{"min":150,"minInclusive":false,"maxInclusive":true,"points":2,"label":">$150m"}]}},{"traitKey":"deals_per_md_l3y","label":"Deals per MD","weight":1,"scoring":{"type":"bands","bands":[{"max":1.5,"minInclusive":true,"maxInclusive":false,"points":0,"label":"<1.5"},{"min":1.5,"max":3.5,"minInclusive":true,"maxInclusive":true,"points":1,"label":"1.5-3.5"},{"min":3.5,"minInclusive":false,"maxInclusive":true,"points":2,"label":">3.5"}]}},{"traitKey":"firm_age","label":"Firm Age","weight":1,"scoring":{"type":"bands","bands":[{"max":5,"minInclusive":true,"maxInclusive":false,"points":0,"label":"<5"},{"min":5,"max":12,"minInclusive":true,"maxInclusive":true,"points":1,"label":"5-12"},{"min":12,"minInclusive":false,"maxInclusive":true,"points":2,"label":">12"}]}},{"traitKey":"employees","label":"Headcount","weight":1,"scoring":{"type":"bands","bands":[{"max":8,"minInclusive":true,"maxInclusive":false,"points":0,"label":"<8"},{"min":8,"max":40,"minInclusive":true,"maxInclusive":true,"points":2,"label":"8-40"},{"min":40,"minInclusive":false,"maxInclusive":true,"points":1,"label":">40"}]}},{"traitKey":"fee_generating_count","label":"Fee-Generating","weight":1,"scoring":{"type":"bands","bands":[{"max":2,"minInclusive":true,"maxInclusive":false,"points":0,"label":"<2"},{"min":2,"max":3,"minInclusive":true,"maxInclusive":true,"points":1,"label":"2-3"},{"min":3,"minInclusive":false,"maxInclusive":true,"points":2,"label":">=4"}]}}],"hardRejects":[{"traitKey":"coverage_model","operator":"==","value":"Generalist","reason":"Generalist coverage model (CF hard-reject)"},{"traitKey":"services_fit","operator":"==","value":"Conflicted: trading, lending or research","reason":"Conflicted services (CF hard-reject)"}],"tiers":{"A":14,"B":10,"C":6},"actions":{"A":"Outreach","B":"Follow","C":"Follow","Rejected":"Enrich","upgrades":[{"tier":"B","minPoints":12,"action":"Outreach"}]}},{"key":"CS","label":"Capital solutions","productGroups":["Capital Solutions"],"criteria":[{"traitKey":"balance_sheet_principal","label":"Balance Sheet / Principal","weight":1,"scoring":{"type":"category","options":[{"value":"Invests its own balance sheet","points":0},{"value":"Occasional co-investment","points":1},{"value":"Advisory only","points":2}]}},{"traitKey":"services_fit","label":"CS Services Fit","weight":1,"scoring":{"type":"category","options":[{"value":"No private-capital products","points":0},{"value":"Some private-capital products","points":1},{"value":"Full private-capital suite","points":2}]}},{"traitKey":"md_pedigree","label":"MD Experience","weight":1,"scoring":{"type":"category","options":[{"value":"Non-finance backgrounds","points":0},{"value":"Some credit or banking experience","points":1},{"value":"Senior credit / capital-markets pedigree","points":2}]}},{"traitKey":"geo_score","label":"Geographic Footprint","weight":1,"scoring":{"type":"direct","min":0,"max":2}},{"traitKey":"deal_size_usd_m","label":"Deal Size","weight":1,"scoring":{"type":"bands","bands":[{"max":25,"minInclusive":true,"maxInclusive":false,"points":0,"label":"<$25m"},{"min":25,"max":150,"minInclusive":true,"maxInclusive":true,"points":1,"label":"$25m-$150m"},{"min":150,"minInclusive":false,"maxInclusive":true,"points":2,"label":">$150m"}]}},{"traitKey":"deals_per_md_l3y","label":"Deals per MD","weight":1,"scoring":{"type":"bands","bands":[{"max":1.5,"minInclusive":true,"maxInclusive":false,"points":0,"label":"<1.5"},{"min":1.5,"max":3.5,"minInclusive":true,"maxInclusive":true,"points":1,"label":"1.5-3.5"},{"min":3.5,"minInclusive":false,"maxInclusive":true,"points":2,"label":">3.5"}]}},{"traitKey":"firm_age","label":"Firm Age","weight":1,"scoring":{"type":"bands","bands":[{"max":5,"minInclusive":true,"maxInclusive":false,"points":0,"label":"<5"},{"min":5,"max":12,"minInclusive":true,"maxInclusive":true,"points":1,"label":"5-12"},{"min":12,"minInclusive":false,"maxInclusive":true,"points":2,"label":">12"}]}},{"traitKey":"employees","label":"Headcount","weight":1,"scoring":{"type":"bands","bands":[{"max":8,"minInclusive":true,"maxInclusive":false,"points":0,"label":"<8"},{"min":8,"max":40,"minInclusive":true,"maxInclusive":true,"points":2,"label":"8-40"},{"min":40,"minInclusive":false,"maxInclusive":true,"points":1,"label":">40"}]}},{"traitKey":"fee_generating_count","label":"Fee-Generating","weight":1,"scoring":{"type":"bands","bands":[{"max":2,"minInclusive":true,"maxInclusive":false,"points":0,"label":"<2"},{"min":2,"max":3,"minInclusive":true,"maxInclusive":true,"points":1,"label":"2-3"},{"min":3,"minInclusive":false,"maxInclusive":true,"points":2,"label":">=4"}]}}],"hardRejects":[{"traitKey":"advisory_conflict","operator":"==","value":"true","reason":"Advisory conflict (CS hard-reject)"},{"traitKey":"balance_sheet_principal","operator":"==","value":"Invests its own balance sheet","reason":"Principal investor (CS hard-reject)"}],"tiers":{"A":13,"B":10,"C":6},"actions":{"A":"Outreach","B":"Follow","C":"Follow","Rejected":"Enrich","upgrades":[{"tier":"B","minPoints":12,"action":"Outreach"}]}}],"candidateScreens":[{"axis":"employees","operator":"<","threshold":"10","keywords":"\\b(small|headcount|staff|employees|people)\\b","summary":"Analysts keep passing on firms too small to absorb an integration (fewer than 10 staff)."},{"axis":"deal_size_usd_m","operator":"<","threshold":"30","keywords":"deal size|small deals|below our floor","summary":"Typical deal sizes under $30m are consistently rejected as below the floor."},{"axis":"deals_per_md_l3y","operator":"<","threshold":"2","keywords":"deal volume|too few deals|deals per md|productivity","summary":"Fewer than two deals per MD over three years reads as a weak franchise."},{"axis":"firm_age","operator":"<","threshold":"3","keywords":"too new|young|track record|founded","summary":"Firms under three years old lack the track record the thesis needs."},{"axis":"geo_score","operator":"<","threshold":"1","keywords":"geograph|footprint|region|market access","summary":"Firms outside core geographies are passed on for footprint."},{"axis":"coverage_model","operator":"==","threshold":"Generalist","keywords":"generalist|unfocused|no sector depth","summary":"Generalist coverage models are rejected for lacking sector depth."}]}$rubric$, 'migration', '2026-11-15T00:00:00.000Z')
ON CONFLICT ("rubricId") DO NOTHING;

-- A reset restores the snapshot; give it copies of the new tables so it does not empty them.
DO $snap$
BEGIN
  IF to_regclass('snapshot_firm') IS NOT NULL THEN
    CREATE TABLE IF NOT EXISTS snapshot_trait AS TABLE trait;
    CREATE TABLE IF NOT EXISTS snapshot_rubric AS TABLE rubric;
  END IF;
END
$snap$;

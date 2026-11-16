-- A firm's trait values move into their own append-only table (ADR 0011, phase B, expand).
--
-- firm_trait_value    One row per value a trait has held for a firm: revision 1, 2, ... per
--                     (firm, trait), the value in the column that matches the trait's kind, who
--                     set it, when, and the finding it came from. Rows are never updated or
--                     deleted; a firm's current value is its highest revision.
-- firm_trait_current  That current value per (firm, trait).
-- firm.thesis         Which of the rubric's theses scores the firm (was firmType).
--
-- The legacy trait columns and firmType stay, unread, until a later migration drops them. This
-- one copies their values as revision 1, in the live tables and in the reset snapshot.

ALTER TABLE firm ADD COLUMN IF NOT EXISTS "thesis" text;
UPDATE firm SET "thesis" = "firmType" WHERE "thesis" IS NULL AND "firmType" IS NOT NULL;

CREATE TABLE IF NOT EXISTS firm_trait_value (
  "traitValueId" text PRIMARY KEY,
  "firmId" text NOT NULL REFERENCES firm ("firmId") DEFERRABLE INITIALLY DEFERRED,
  "traitKey" text NOT NULL,
  "revision" integer NOT NULL,
  "valueString" text,
  "valueNumber" double precision,
  "valueBoolean" boolean,
  "sourceFindingId" text,
  "setBy" text NOT NULL,
  "setAt" timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS firm_trait_value_revision
  ON firm_trait_value ("firmId", "traitKey", "revision");

CREATE OR REPLACE VIEW firm_trait_current AS
  SELECT DISTINCT ON ("firmId", "traitKey") *
    FROM firm_trait_value
   ORDER BY "firmId", "traitKey", "revision" DESC;

CREATE OR REPLACE FUNCTION firm_trait_value_append_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'firm_trait_value is append-only' USING ERRCODE = 'restrict_violation';
END
$fn$;
DROP TRIGGER IF EXISTS firm_trait_value_append_only ON firm_trait_value;
CREATE TRIGGER firm_trait_value_append_only BEFORE UPDATE OR DELETE ON firm_trait_value
  FOR EACH ROW EXECUTE FUNCTION firm_trait_value_append_only();

-- Revision 1 of every non-empty legacy column, from `source` (firm or snapshot_firm) into `target`.
-- A value is dated when the firm was enriched, else at `fallback`.
CREATE OR REPLACE FUNCTION backfill_trait_values_0005(source text, target text, fallback timestamptz)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  col record;
BEGIN
  FOR col IN
    SELECT * FROM (VALUES
      ('servicesFit', 'services_fit', 'valueString', 'text'),
      ('mdPedigree', 'md_pedigree', 'valueString', 'text'),
      ('balanceSheetPrincipal', 'balance_sheet_principal', 'valueString', 'text'),
      ('dealSizeMUsd', 'deal_size_usd_m', 'valueNumber', 'double precision'),
      ('dealsPerMdL3y', 'deals_per_md_l3y', 'valueNumber', 'double precision'),
      ('firmAge', 'firm_age', 'valueNumber', 'double precision'),
      ('feeGeneratingCount', 'fee_generating_count', 'valueNumber', 'double precision'),
      ('advisoryConflict', 'advisory_conflict', 'valueBoolean', 'boolean'),
      ('hasSTOrBalanceSheet', 'has_st_or_balance_sheet', 'valueBoolean', 'boolean'),
      ('webActivity', 'web_activity', 'valueBoolean', 'boolean'),
      ('solvent', 'solvent', 'valueBoolean', 'boolean'),
      ('coverageModel', 'coverage_model', 'valueString', 'text'),
      ('geoScore', 'geo_score', 'valueNumber', 'double precision'),
      ('employees', 'employees', 'valueNumber', 'double precision'),
      ('revenueBand', 'revenue_band', 'valueString', 'text'),
      ('ownership', 'ownership', 'valueString', 'text'),
      ('successionRisk', 'succession_risk', 'valueString', 'text')
    ) AS c (column_name, trait_key, value_column, value_type)
  LOOP
    EXECUTE format(
      'INSERT INTO %I ("traitValueId", "firmId", "traitKey", "revision", %I, "setBy", "setAt")
       SELECT f."firmId" || %L, f."firmId", %L, 1, f.%I::%s, ''migration'', coalesce(f."enrichedAt", $1)
         FROM %I f
        WHERE f.%I IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM %I t WHERE t."firmId" = f."firmId" AND t."traitKey" = %L)',
      target, col.value_column, ':' || col.trait_key || ':1', col.trait_key, col.column_name,
      col.value_type, source, col.column_name, target, col.trait_key)
    USING fallback;
  END LOOP;
END
$fn$;

SELECT backfill_trait_values_0005('firm', 'firm_trait_value', now());

-- A reset restores the snapshot: give it the thesis and a trait-value copy, dated in the snapshot's
-- own time so the reset moves them forward with everything else.
DO $snap$
BEGIN
  IF to_regclass('snapshot_firm') IS NOT NULL THEN
    ALTER TABLE snapshot_firm ADD COLUMN IF NOT EXISTS "thesis" text;
    UPDATE snapshot_firm SET "thesis" = "firmType" WHERE "thesis" IS NULL AND "firmType" IS NOT NULL;
    CREATE TABLE IF NOT EXISTS snapshot_firm_trait_value AS TABLE firm_trait_value WITH NO DATA;
    PERFORM backfill_trait_values_0005(
      'snapshot_firm',
      'snapshot_firm_trait_value',
      coalesce((SELECT value::timestamptz FROM meta WHERE key = 'snapshotAt'), now())
    );
  END IF;
END
$snap$;

DROP FUNCTION backfill_trait_values_0005(text, text, timestamptz);

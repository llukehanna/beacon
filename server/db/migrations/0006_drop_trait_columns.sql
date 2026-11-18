-- The firm's legacy trait columns go (ADR 0011, phase B, contract).
--
-- Migration 0005 copied every firm's trait columns into firm_trait_value and firmType into thesis,
-- and the app has read and written only those since. This drops the seventeen trait columns and
-- firmType from firm and from the reset snapshot.
--
-- Before dropping anything it checks that no column still holds something the trait values lack:
-- a firmType with no thesis, or a trait column with no trait value for that firm. If one does, the
-- migration fails naming the firm and the column, and nothing changes.
--
-- The whole-number check moves into the catalog: trait gains "wholeNumber", set for the number
-- traits that were integer columns (years and people).

ALTER TABLE trait ADD COLUMN IF NOT EXISTS "wholeNumber" boolean NOT NULL DEFAULT false;
UPDATE trait SET "wholeNumber" = true
 WHERE "workspaceKey" = 'advisory-acquisitions'
   AND "traitKey" IN ('firm_age', 'fee_generating_count', 'geo_score', 'employees');

CREATE FUNCTION check_trait_columns_0006(firms text, trait_values text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  m record;
  hit text;
BEGIN
  FOR m IN
    SELECT v.col, v.key FROM (VALUES
      ('servicesFit', 'services_fit'),
      ('mdPedigree', 'md_pedigree'),
      ('balanceSheetPrincipal', 'balance_sheet_principal'),
      ('dealSizeMUsd', 'deal_size_usd_m'),
      ('dealsPerMdL3y', 'deals_per_md_l3y'),
      ('firmAge', 'firm_age'),
      ('feeGeneratingCount', 'fee_generating_count'),
      ('advisoryConflict', 'advisory_conflict'),
      ('hasSTOrBalanceSheet', 'has_st_or_balance_sheet'),
      ('webActivity', 'web_activity'),
      ('solvent', 'solvent'),
      ('coverageModel', 'coverage_model'),
      ('geoScore', 'geo_score'),
      ('employees', 'employees'),
      ('revenueBand', 'revenue_band'),
      ('ownership', 'ownership'),
      ('successionRisk', 'succession_risk')
    ) AS v(col, key)
    JOIN information_schema.columns c
      ON c.table_schema = current_schema() AND c.table_name = firms AND c.column_name = v.col
  LOOP
    EXECUTE format(
      'SELECT f."firmId" FROM %I f WHERE f.%I IS NOT NULL AND NOT EXISTS ('
        'SELECT 1 FROM %I t WHERE t."firmId" = f."firmId" AND t."traitKey" = %L) LIMIT 1',
      firms, m.col, trait_values, m.key) INTO hit;
    IF hit IS NOT NULL THEN
      RAISE EXCEPTION 'migration 0006: %.% holds % for firm % with no % trait value',
        firms, m.col, m.col, hit, m.key;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = current_schema() AND table_name = firms
                AND column_name = 'firmType') THEN
    EXECUTE format(
      'SELECT "firmId" FROM %I WHERE "firmType" IS NOT NULL AND "thesis" IS NULL LIMIT 1', firms)
      INTO hit;
    IF hit IS NOT NULL THEN
      RAISE EXCEPTION 'migration 0006: firm % has a firmType but no thesis', hit;
    END IF;
  END IF;
END
$fn$;

SELECT check_trait_columns_0006('firm', 'firm_trait_value');

ALTER TABLE firm
  DROP COLUMN IF EXISTS "firmType",
  DROP COLUMN IF EXISTS "servicesFit",
  DROP COLUMN IF EXISTS "mdPedigree",
  DROP COLUMN IF EXISTS "balanceSheetPrincipal",
  DROP COLUMN IF EXISTS "dealSizeMUsd",
  DROP COLUMN IF EXISTS "dealsPerMdL3y",
  DROP COLUMN IF EXISTS "firmAge",
  DROP COLUMN IF EXISTS "feeGeneratingCount",
  DROP COLUMN IF EXISTS "advisoryConflict",
  DROP COLUMN IF EXISTS "hasSTOrBalanceSheet",
  DROP COLUMN IF EXISTS "webActivity",
  DROP COLUMN IF EXISTS "solvent",
  DROP COLUMN IF EXISTS "coverageModel",
  DROP COLUMN IF EXISTS "geoScore",
  DROP COLUMN IF EXISTS "employees",
  DROP COLUMN IF EXISTS "revenueBand",
  DROP COLUMN IF EXISTS "ownership",
  DROP COLUMN IF EXISTS "successionRisk";

-- The reset snapshot gets the same shape, so a reset restores firms and the catalog as they are now.
DO $snap$
BEGIN
  IF to_regclass('snapshot_trait') IS NOT NULL THEN
    ALTER TABLE snapshot_trait ADD COLUMN IF NOT EXISTS "wholeNumber" boolean NOT NULL DEFAULT false;
    UPDATE snapshot_trait SET "wholeNumber" = true
     WHERE "workspaceKey" = 'advisory-acquisitions'
       AND "traitKey" IN ('firm_age', 'fee_generating_count', 'geo_score', 'employees');
  END IF;
  IF to_regclass('snapshot_firm') IS NOT NULL THEN
    PERFORM check_trait_columns_0006('snapshot_firm', 'snapshot_firm_trait_value');
    ALTER TABLE snapshot_firm
      DROP COLUMN IF EXISTS "firmType",
      DROP COLUMN IF EXISTS "servicesFit",
      DROP COLUMN IF EXISTS "mdPedigree",
      DROP COLUMN IF EXISTS "balanceSheetPrincipal",
      DROP COLUMN IF EXISTS "dealSizeMUsd",
      DROP COLUMN IF EXISTS "dealsPerMdL3y",
      DROP COLUMN IF EXISTS "firmAge",
      DROP COLUMN IF EXISTS "feeGeneratingCount",
      DROP COLUMN IF EXISTS "advisoryConflict",
      DROP COLUMN IF EXISTS "hasSTOrBalanceSheet",
      DROP COLUMN IF EXISTS "webActivity",
      DROP COLUMN IF EXISTS "solvent",
      DROP COLUMN IF EXISTS "coverageModel",
      DROP COLUMN IF EXISTS "geoScore",
      DROP COLUMN IF EXISTS "employees",
      DROP COLUMN IF EXISTS "revenueBand",
      DROP COLUMN IF EXISTS "ownership",
      DROP COLUMN IF EXISTS "successionRisk";
  END IF;
END
$snap$;

DROP FUNCTION check_trait_columns_0006(text, text);

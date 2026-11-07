-- Integrity: the database refuses what the application never writes. Four things, in this order.
--
-- 0. Repair. A row that would break a constraint below is fixed first, and each repair is written
--    to migration_repair (the whole row as JSON, so nothing is lost). A database that never held
--    such a row logs nothing. The snapshot_* copies the nightly reset restores are repaired the same
--    way: a violating row there would otherwise fail every reset.
--      - A required timestamp that is empty is backfilled from a related row where one says when
--        (a rule from the decisions that support it, a mandate from its searches, a finding from
--        its verification or its firm's enrichment ...), else with the time of the migration (the
--        snapshot's own time, in a snapshot copy). The row is kept. A snapshot copy saved before
--        the column existed gets the column, backfilled the same way.
--      - A reference that names nothing is cleared where the column may be empty
--        (review_decision.firmId, firm.discoveredViaSearchId) and the row is removed where it may
--        not. A required reference that is NULL removes the row, since nothing says what it was.
--      - A group of proposed rules with one predicate keeps one rule (the approved one, else the
--        pending one, else the oldest); the others' configs move to it.
--
-- 1. NOT NULL on the columns `required` lists in shared/schema.ts: the reference columns and the
--    timestamps every writer sets (the primary key is already NOT NULL).
--
-- 2. Foreign keys, all DEFERRABLE INITIALLY DEFERRED so they are checked at COMMIT: the seed and the
--    reset insert tables in any order inside one transaction, and a search action inserts a firm
--    before the search that discovered it.
--      firm.discoveredViaSearchId        -> search
--      search.mandateId                  -> mandate
--      search_list.mandateId             -> mandate
--      mandate_access.mandateId          -> mandate
--      search_membership.searchId        -> search
--      search_membership.firmId          -> firm
--      search_list_firm.searchId         -> search_list
--      search_list_firm.firmId           -> firm
--      research_finding.firmId           -> firm
--      extraction.firmId                 -> firm
--      qualification_score.firmId        -> firm
--      review_decision.firmId            -> firm   (null for a decision about no firm)
--      drift_event.firmId                -> firm
--      market_signal.firmId              -> firm
--      restricted_firm.firmId            -> firm
--      hard_screen_config.sourceProposedRuleId -> proposed_rule
--    No ON DELETE action: nothing deletes a firm, mandate, search or rule, and the database should
--    say so if something starts to. TRUNCATE of a referenced table must name every table that
--    references it, which the reset does (it truncates every demo table in one statement).
--
-- 3. One proposed rule per predicate: a unique index on the key ruleKey() in
--    shared/predicate.ts builds (axis, operator, threshold and model, trimmed and lower-cased, an
--    empty model meaning "both"), so two clustering runs racing to propose the same rule cannot both
--    land, whatever the case or spacing they used. An expression index rather than UNIQUE NULLS NOT
--    DISTINCT, so it needs no particular Postgres version.
--
-- 4. Append-only history. A BEFORE UPDATE OR DELETE trigger on each history table raises
--    '<table> is append-only'.
--      qualification_score_append_only   no UPDATE, no DELETE
--      review_decision_append_only       no UPDATE, no DELETE
--      research_finding_append_only      no DELETE; an UPDATE may change only findingStatus,
--                                        verifiedByHuman, verifiedBy and verifiedAt
--    TRUNCATE does not fire a row trigger, so the nightly reset still clears and restores them.
--    A role that owns the table can still drop a trigger, so this guards against a bug or a stray
--    statement, not against someone with the owner's connection string.
--
-- The whole migration runs in one transaction, so it is all or nothing.

CREATE TABLE migration_repair (
  "repairId" bigserial PRIMARY KEY,
  "version" integer NOT NULL,
  "tableName" text NOT NULL,
  "rowKey" text,
  "action" text NOT NULL,
  "reason" text NOT NULL,
  "rowData" jsonb,
  "repairedAt" timestamptz NOT NULL DEFAULT now()
);

-- Helpers for the repair, dropped at the end. Each acts on the live table and on its snapshot copy
-- when there is one. `keyexpr` is a SQL expression over the row as jsonb `j` that names the row.

-- Remove the rows whose `col` is null.
CREATE FUNCTION beacon_repair_nulls(tbl text, col text, keyexpr text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[tbl, 'snapshot_' || tbl] LOOP
    IF to_regclass(target) IS NULL THEN
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = target AND column_name = col
    ) THEN
      -- A snapshot saved before the column existed: only `npm run seed` can rebuild it.
      IF target <> tbl THEN
        INSERT INTO migration_repair ("version", "tableName", "action", "reason")
        VALUES (3, target, 'skipped', col || ' is missing from the snapshot copy: run npm run seed');
      END IF;
      CONTINUE;
    END IF;
    EXECUTE format(
      $q$INSERT INTO migration_repair ("version", "tableName", "rowKey", "action", "reason", "rowData")
         SELECT 3, %L, %s, 'deleted', %L, j FROM (SELECT to_jsonb(c) AS j FROM %I c WHERE c.%I IS NULL) s$q$,
      target, keyexpr, col || ' is required', target, col);
    EXECUTE format('DELETE FROM %I WHERE %I IS NULL', target, col);
  END LOOP;
END
$fn$;

-- Fix the rows whose `col` names a row of `parent` that does not exist: clear the reference when the
-- column may be empty, otherwise remove the row.
CREATE FUNCTION beacon_repair_orphans(
  child text, col text, parent text, parentkey text, clear boolean, keyexpr text
) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  prefix text;
  c text;
  p text;
  orphan text;
BEGIN
  FOREACH prefix IN ARRAY ARRAY['', 'snapshot_'] LOOP
    c := prefix || child;
    p := prefix || parent;
    IF to_regclass(c) IS NULL OR to_regclass(p) IS NULL THEN
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = c AND column_name = col
    ) THEN
      CONTINUE;
    END IF;
    orphan := format(
      '%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I q WHERE q.%I = %I.%I)',
      col, p, parentkey, c, col);
    EXECUTE format(
      $q$INSERT INTO migration_repair ("version", "tableName", "rowKey", "action", "reason", "rowData")
         SELECT 3, %L, %s, %L, %L, j FROM (SELECT to_jsonb(%I) AS j FROM %I WHERE %s) s$q$,
      c, keyexpr, CASE WHEN clear THEN 'cleared' ELSE 'deleted' END,
      col || ' names no ' || parent, c, c, orphan);
    IF clear THEN
      EXECUTE format('UPDATE %I SET %I = NULL WHERE %s', c, col, orphan);
    ELSE
      EXECUTE format('DELETE FROM %I WHERE %s', c, orphan);
    END IF;
  END LOOP;
END
$fn$;

-- Fill the rows whose timestamp `col` is empty, in the live table and its snapshot copy. `expr` is
-- evaluated per row (alias c); {p} stands for the table-name prefix ('' or 'snapshot_') and {fb} for
-- the fallback time. A snapshot copy that lacks the column gets it first. If the snapshot lacks
-- something `expr` reads, the fallback alone is used.
CREATE FUNCTION beacon_backfill(tbl text, col text, expr text, keyexpr text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  prefix text;
  target text;
  fb text;
  filled text;
BEGIN
  FOREACH prefix IN ARRAY ARRAY['', 'snapshot_'] LOOP
    target := prefix || tbl;
    IF to_regclass(target) IS NULL THEN
      CONTINUE;
    END IF;
    fb := CASE WHEN prefix = '' THEN 'now()'
               ELSE $f$coalesce((SELECT value::timestamptz FROM meta WHERE key = 'snapshotAt'), now())$f$ END;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = target AND column_name = col
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN %I timestamptz', target, col);
      INSERT INTO migration_repair ("version", "tableName", "action", "reason")
      VALUES (3, target, 'added', col || ' was missing from the snapshot copy; added and backfilled');
    END IF;
    EXECUTE format(
      $q$INSERT INTO migration_repair ("version", "tableName", "rowKey", "action", "reason", "rowData")
         SELECT 3, %L, %s, 'backfilled', %L, j FROM (SELECT to_jsonb(c) AS j FROM %I c WHERE c.%I IS NULL) s$q$,
      target, keyexpr, col || ' is required and was empty', target, col);
    filled := replace(replace(expr, '{p}', prefix), '{fb}', fb);
    BEGIN
      EXECUTE format('UPDATE %I c SET %I = %s WHERE c.%I IS NULL', target, col, filled, col);
    EXCEPTION WHEN undefined_column OR undefined_table THEN
      EXECUTE format('UPDATE %I c SET %I = %s WHERE c.%I IS NULL', target, col, fb, col);
    END;
  END LOOP;
END
$fn$;

-- Keep one of each group of proposed rules that share a predicate: the approved one, else the
-- pending one, else the oldest. The others are removed and their configs follow the survivor.
CREATE FUNCTION beacon_repair_duplicate_rules() RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  prefix text;
  r text;
  h text;
BEGIN
  FOREACH prefix IN ARRAY ARRAY['', 'snapshot_'] LOOP
    r := prefix || 'proposed_rule';
    h := prefix || 'hard_screen_config';
    IF to_regclass(r) IS NULL THEN
      CONTINUE;
    END IF;
    -- A snapshot saved before one of these columns existed has no duplicates to speak of.
    IF (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = r
           AND column_name IN ('proposedRuleId', 'predicateAxis', 'ruleOperator', 'ruleThreshold',
                               'ruleModel', 'ruleStatus', 'proposedAt')) < 7 THEN
      CONTINUE;
    END IF;
    EXECUTE format($q$CREATE TEMP TABLE rule_keep ON COMMIT DROP AS
      SELECT "proposedRuleId" AS id,
             first_value("proposedRuleId") OVER w AS keep,
             row_number() OVER w AS rn
        FROM %I
      WINDOW w AS (
        PARTITION BY lower(btrim(coalesce("predicateAxis", ''), E' \t\n\r\f\v')),
                     lower(btrim(coalesce("ruleOperator", ''), E' \t\n\r\f\v')),
                     lower(btrim(coalesce("ruleThreshold", ''), E' \t\n\r\f\v')),
                     lower(btrim(coalesce(nullif("ruleModel", ''), 'both'), E' \t\n\r\f\v'))
        ORDER BY CASE "ruleStatus" WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
                 "proposedAt" NULLS LAST, "proposedRuleId")$q$, r);
    IF to_regclass(h) IS NOT NULL AND (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = h
           AND column_name IN ('configRuleId', 'sourceProposedRuleId')) = 2 THEN
      EXECUTE format($q$INSERT INTO migration_repair ("version", "tableName", "rowKey", "action", "reason", "rowData")
        SELECT 3, %L, to_jsonb(c)->>'configRuleId', 'repointed',
               'its rule duplicated ' || k.keep, to_jsonb(c)
          FROM %I c JOIN rule_keep k ON k.id = c."sourceProposedRuleId" WHERE k.rn > 1$q$, h, h);
      EXECUTE format($q$UPDATE %I c SET "sourceProposedRuleId" = k.keep
          FROM rule_keep k WHERE k.id = c."sourceProposedRuleId" AND k.rn > 1$q$, h);
    END IF;
    EXECUTE format($q$INSERT INTO migration_repair ("version", "tableName", "rowKey", "action", "reason", "rowData")
      SELECT 3, %L, to_jsonb(c)->>'proposedRuleId', 'deleted',
             'duplicates the rule ' || k.keep, to_jsonb(c)
        FROM %I c JOIN rule_keep k ON k.id = c."proposedRuleId" WHERE k.rn > 1$q$, r, r);
    EXECUTE format($q$DELETE FROM %I c USING rule_keep k
        WHERE k.id = c."proposedRuleId" AND k.rn > 1$q$, r);
    DROP TABLE rule_keep;
  END LOOP;
END
$fn$;

-- 0. Repair. A required reference that is NULL removes the row.
SELECT beacon_repair_nulls('search', 'mandateId', 'j->>''searchId''');
SELECT beacon_repair_nulls('search_list', 'mandateId', 'j->>''searchId''');
SELECT beacon_repair_nulls('search_membership', 'searchId', 'j->>''membershipId''');
SELECT beacon_repair_nulls('search_membership', 'firmId', 'j->>''membershipId''');
SELECT beacon_repair_nulls('research_finding', 'firmId', 'j->>''findingId''');
SELECT beacon_repair_nulls('extraction', 'firmId', 'j->>''extractionId''');
SELECT beacon_repair_nulls('qualification_score', 'firmId', 'j->>''scoreId''');
SELECT beacon_repair_nulls('drift_event', 'firmId', 'j->>''driftEventId''');
SELECT beacon_repair_nulls('hard_screen_config', 'sourceProposedRuleId', 'j->>''configRuleId''');
SELECT beacon_repair_nulls('market_signal', 'firmId', 'j->>''signalId''');
SELECT beacon_repair_nulls('mandate_access', 'mandateId', 'j->>''accessId''');

-- A required timestamp that is empty is filled in, and the row kept. A mandate first (from its
-- searches), then the searches and lists (from the mandate).
SELECT beacon_backfill('mandate', 'createdAt',
  $e$coalesce((SELECT min(s."runAt") FROM {p}search s WHERE s."mandateId" = c."mandateId"),
              (SELECT min(l."createdAt") FROM {p}search_list l WHERE l."mandateId" = c."mandateId"), {fb})$e$,
  'j->>''mandateId''');
SELECT beacon_backfill('search', 'runAt',
  $e$coalesce((SELECT m."createdAt" FROM {p}mandate m WHERE m."mandateId" = c."mandateId"), {fb})$e$,
  'j->>''searchId''');
SELECT beacon_backfill('search_list', 'createdAt',
  $e$coalesce((SELECT m."createdAt" FROM {p}mandate m WHERE m."mandateId" = c."mandateId"), {fb})$e$,
  'j->>''searchId''');
SELECT beacon_backfill('research_finding', 'retrievedAt',
  $e$coalesce(c."verifiedAt", (SELECT f."enrichedAt" FROM {p}firm f WHERE f."firmId" = c."firmId"), {fb})$e$,
  'j->>''findingId''');
SELECT beacon_backfill('extraction', 'extractedAt',
  $e$coalesce((SELECT f."enrichedAt" FROM {p}firm f WHERE f."firmId" = c."firmId"), {fb})$e$,
  'j->>''extractionId''');
SELECT beacon_backfill('qualification_score', 'computedAt',
  $e$coalesce((SELECT f."enrichedAt" FROM {p}firm f WHERE f."firmId" = c."firmId"), {fb})$e$,
  'j->>''scoreId''');
SELECT beacon_backfill('review_decision', 'decidedAt', '{fb}', 'j->>''decisionId''');
SELECT beacon_backfill('drift_event', 'detectedAt', 'coalesce(c."resolvedAt", {fb})', 'j->>''driftEventId''');
-- A rule was proposed when the last of the decisions that support it was made.
SELECT beacon_backfill('proposed_rule', 'proposedAt',
  $e$coalesce((SELECT max(d."decidedAt") FROM {p}review_decision d
                WHERE position('"' || d."decisionId" || '"' in c."supportingDecisionIds") > 0),
              c."ruleDecidedAt", {fb})$e$,
  'j->>''proposedRuleId''');
SELECT beacon_backfill('hard_screen_config', 'configCreatedAt',
  $e$coalesce((SELECT r."ruleDecidedAt" FROM {p}proposed_rule r WHERE r."proposedRuleId" = c."sourceProposedRuleId"), {fb})$e$,
  'j->>''configRuleId''');
SELECT beacon_backfill('market_signal', 'effectiveDate', 'coalesce(c."appliedAt", {fb})', 'j->>''signalId''');
SELECT beacon_backfill('restricted_firm', 'addedAt', '{fb}', 'j->>''firmId''');
SELECT beacon_backfill('access_log_entry', 'viewedAt', '{fb}', 'j->>''entryId''');
SELECT beacon_backfill('action_run', 'startedAt', '{fb}', 'j->>''actionRunId''');
SELECT beacon_backfill('model_call', 'calledAt', '{fb}', 'j->>''modelCallId''');

SELECT beacon_repair_duplicate_rules();

-- References, parents before children: mandate's children, then search's, search_list's and the
-- rule's, then firm's.
SELECT beacon_repair_orphans('search', 'mandateId', 'mandate', 'mandateId', false, 'j->>''searchId''');
SELECT beacon_repair_orphans('search_list', 'mandateId', 'mandate', 'mandateId', false, 'j->>''searchId''');
SELECT beacon_repair_orphans('mandate_access', 'mandateId', 'mandate', 'mandateId', false, 'j->>''accessId''');
SELECT beacon_repair_orphans('search_membership', 'searchId', 'search', 'searchId', false, 'j->>''membershipId''');
SELECT beacon_repair_orphans('firm', 'discoveredViaSearchId', 'search', 'searchId', true, 'j->>''firmId''');
SELECT beacon_repair_orphans('search_list_firm', 'searchId', 'search_list', 'searchId', false, '(j->>''searchId'') || '':'' || (j->>''firmId'')');
SELECT beacon_repair_orphans('hard_screen_config', 'sourceProposedRuleId', 'proposed_rule', 'proposedRuleId', false, 'j->>''configRuleId''');
SELECT beacon_repair_orphans('search_membership', 'firmId', 'firm', 'firmId', false, 'j->>''membershipId''');
SELECT beacon_repair_orphans('search_list_firm', 'firmId', 'firm', 'firmId', false, '(j->>''searchId'') || '':'' || (j->>''firmId'')');
SELECT beacon_repair_orphans('research_finding', 'firmId', 'firm', 'firmId', false, 'j->>''findingId''');
SELECT beacon_repair_orphans('extraction', 'firmId', 'firm', 'firmId', false, 'j->>''extractionId''');
SELECT beacon_repair_orphans('qualification_score', 'firmId', 'firm', 'firmId', false, 'j->>''scoreId''');
SELECT beacon_repair_orphans('review_decision', 'firmId', 'firm', 'firmId', true, 'j->>''decisionId''');
SELECT beacon_repair_orphans('drift_event', 'firmId', 'firm', 'firmId', false, 'j->>''driftEventId''');
SELECT beacon_repair_orphans('market_signal', 'firmId', 'firm', 'firmId', false, 'j->>''signalId''');
SELECT beacon_repair_orphans('restricted_firm', 'firmId', 'firm', 'firmId', false, 'j->>''firmId''');

DROP FUNCTION beacon_repair_nulls(text, text, text);
DROP FUNCTION beacon_backfill(text, text, text, text);
DROP FUNCTION beacon_repair_orphans(text, text, text, text, boolean, text);
DROP FUNCTION beacon_repair_duplicate_rules();

-- 1. Required columns.
ALTER TABLE mandate ALTER COLUMN "createdAt" SET NOT NULL;
ALTER TABLE search ALTER COLUMN "mandateId" SET NOT NULL, ALTER COLUMN "runAt" SET NOT NULL;
ALTER TABLE search_list ALTER COLUMN "mandateId" SET NOT NULL, ALTER COLUMN "createdAt" SET NOT NULL;
ALTER TABLE search_membership ALTER COLUMN "searchId" SET NOT NULL, ALTER COLUMN "firmId" SET NOT NULL;
ALTER TABLE research_finding ALTER COLUMN "firmId" SET NOT NULL, ALTER COLUMN "retrievedAt" SET NOT NULL;
ALTER TABLE extraction ALTER COLUMN "firmId" SET NOT NULL, ALTER COLUMN "extractedAt" SET NOT NULL;
ALTER TABLE qualification_score ALTER COLUMN "firmId" SET NOT NULL, ALTER COLUMN "computedAt" SET NOT NULL;
ALTER TABLE review_decision ALTER COLUMN "decidedAt" SET NOT NULL;
ALTER TABLE drift_event ALTER COLUMN "firmId" SET NOT NULL, ALTER COLUMN "detectedAt" SET NOT NULL;
ALTER TABLE proposed_rule ALTER COLUMN "proposedAt" SET NOT NULL;
ALTER TABLE hard_screen_config ALTER COLUMN "sourceProposedRuleId" SET NOT NULL, ALTER COLUMN "configCreatedAt" SET NOT NULL;
ALTER TABLE market_signal ALTER COLUMN "firmId" SET NOT NULL, ALTER COLUMN "effectiveDate" SET NOT NULL;
ALTER TABLE mandate_access ALTER COLUMN "mandateId" SET NOT NULL;
ALTER TABLE restricted_firm ALTER COLUMN "addedAt" SET NOT NULL;
ALTER TABLE access_log_entry ALTER COLUMN "viewedAt" SET NOT NULL;
ALTER TABLE action_run ALTER COLUMN "startedAt" SET NOT NULL;
ALTER TABLE model_call ALTER COLUMN "calledAt" SET NOT NULL;

-- 2. Foreign keys, checked at COMMIT.
ALTER TABLE firm ADD CONSTRAINT firm_discovered_via_search_fkey FOREIGN KEY ("discoveredViaSearchId") REFERENCES search ("searchId") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE search ADD CONSTRAINT search_mandate_fkey FOREIGN KEY ("mandateId") REFERENCES mandate ("mandateId") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE search_list ADD CONSTRAINT search_list_mandate_fkey FOREIGN KEY ("mandateId") REFERENCES mandate ("mandateId") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE mandate_access ADD CONSTRAINT mandate_access_mandate_fkey FOREIGN KEY ("mandateId") REFERENCES mandate ("mandateId") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE search_membership ADD CONSTRAINT search_membership_search_fkey FOREIGN KEY ("searchId") REFERENCES search ("searchId") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE search_membership ADD CONSTRAINT search_membership_firm_fkey FOREIGN KEY ("firmId") REFERENCES firm ("firmId") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE search_list_firm ADD CONSTRAINT search_list_firm_search_list_fkey FOREIGN KEY ("searchId") REFERENCES search_list ("searchId") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE search_list_firm ADD CONSTRAINT search_list_firm_firm_fkey FOREIGN KEY ("firmId") REFERENCES firm ("firmId") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE research_finding ADD CONSTRAINT research_finding_firm_fkey FOREIGN KEY ("firmId") REFERENCES firm ("firmId") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE extraction ADD CONSTRAINT extraction_firm_fkey FOREIGN KEY ("firmId") REFERENCES firm ("firmId") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE qualification_score ADD CONSTRAINT qualification_score_firm_fkey FOREIGN KEY ("firmId") REFERENCES firm ("firmId") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE review_decision ADD CONSTRAINT review_decision_firm_fkey FOREIGN KEY ("firmId") REFERENCES firm ("firmId") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE drift_event ADD CONSTRAINT drift_event_firm_fkey FOREIGN KEY ("firmId") REFERENCES firm ("firmId") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE market_signal ADD CONSTRAINT market_signal_firm_fkey FOREIGN KEY ("firmId") REFERENCES firm ("firmId") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE restricted_firm ADD CONSTRAINT restricted_firm_firm_fkey FOREIGN KEY ("firmId") REFERENCES firm ("firmId") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE hard_screen_config ADD CONSTRAINT hard_screen_config_source_rule_fkey FOREIGN KEY ("sourceProposedRuleId") REFERENCES proposed_rule ("proposedRuleId") DEFERRABLE INITIALLY DEFERRED;

-- 3. One proposed rule per predicate: exactly the key ruleKey() builds in shared/predicate.ts.
CREATE UNIQUE INDEX proposed_rule_predicate_key ON proposed_rule (
  (lower(btrim(coalesce("predicateAxis", ''), E' \t\n\r\f\v'))),
  (lower(btrim(coalesce("ruleOperator", ''), E' \t\n\r\f\v'))),
  (lower(btrim(coalesce("ruleThreshold", ''), E' \t\n\r\f\v'))),
  (lower(btrim(coalesce(nullif("ruleModel", ''), 'both'), E' \t\n\r\f\v')))
);

-- 4. Append-only history.
CREATE FUNCTION qualification_score_append_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'qualification_score is append-only' USING ERRCODE = 'restrict_violation';
END
$fn$;
CREATE TRIGGER qualification_score_append_only BEFORE UPDATE OR DELETE ON qualification_score
  FOR EACH ROW EXECUTE FUNCTION qualification_score_append_only();

CREATE FUNCTION review_decision_append_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'review_decision is append-only' USING ERRCODE = 'restrict_violation';
END
$fn$;
CREATE TRIGGER review_decision_append_only BEFORE UPDATE OR DELETE ON review_decision
  FOR EACH ROW EXECUTE FUNCTION review_decision_append_only();

CREATE FUNCTION research_finding_append_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  mutable constant text[] := ARRAY['findingStatus', 'verifiedByHuman', 'verifiedBy', 'verifiedAt'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'research_finding is append-only' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'research_finding is append-only: only findingStatus, verifiedByHuman, verifiedBy and verifiedAt may change'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER research_finding_append_only BEFORE UPDATE OR DELETE ON research_finding
  FOR EACH ROW EXECUTE FUNCTION research_finding_append_only();

-- Traits and the rubric become data (ADR 0011).
--
-- trait   One row per trait a workspace knows about a firm: its kind (category, number, yesno),
--         its role (evidence, fact, profile), its vocabulary and display label, in catalog order.
-- rubric  One row per published rubric version: the whole definition as one JSON document, so a
--         score can cite an exact, immutable rule set. Append-only: a version is never rewritten
--         or deleted; only "active" may change, and one version per workspace is active.
--
-- The seed writes both. Firms still store their trait values as columns; the API derives a
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

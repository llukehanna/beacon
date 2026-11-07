-- A date no longer lives inside text. Both changes are idempotent, and the snapshot copies are
-- rewritten too when they exist, so a reset restores the new shape.
--
-- 1. A search's name used to end with its run date (" · 2026-09-01"). It is now the mandate's title
--    alone; the screens show the date from the search's runAt.
-- 2. A drift event's changedAxes used to carry a "dated" key per axis. The screens read detectedAt.

UPDATE search
SET name = regexp_replace(name, ' · \d{4}-\d{2}-\d{2}$', '')
WHERE name ~ ' · \d{4}-\d{2}-\d{2}$';

UPDATE drift_event
SET "changedAxes" = regexp_replace(regexp_replace("changedAxes", ',"dated":"[^"]*"', '', 'g'), '"dated":"[^"]*",', '', 'g')
WHERE "changedAxes" LIKE '%"dated"%';

DO $$
BEGIN
  IF to_regclass('snapshot_search') IS NOT NULL THEN
    UPDATE snapshot_search
    SET name = regexp_replace(name, ' · \d{4}-\d{2}-\d{2}$', '')
    WHERE name ~ ' · \d{4}-\d{2}-\d{2}$';
  END IF;
  IF to_regclass('snapshot_drift_event') IS NOT NULL THEN
    UPDATE snapshot_drift_event
    SET "changedAxes" = regexp_replace(regexp_replace("changedAxes", ',"dated":"[^"]*"', '', 'g'), '"dated":"[^"]*",', '', 'g')
    WHERE "changedAxes" LIKE '%"dated"%';
  END IF;
END
$$;

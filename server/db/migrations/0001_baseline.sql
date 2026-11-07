-- Baseline schema: one table per object type (camelCase columns, quoted), the join and meta tables, and
-- their indexes. Every statement is idempotent, so this adopts a database that the earlier runtime
-- schema step already created (production) as well as an empty one.
--
-- The ALTER TABLE statements add any property column a table created before that property existed
-- lacks. Each takes a brief lock on its table; the runner gives up after 5 seconds rather than
-- queueing live traffic behind it.

CREATE TABLE IF NOT EXISTS firm (
  "firmId" text PRIMARY KEY,
  "firmName" text,
  "source" text,
  "firmType" text,
  "hqCountry" text,
  "geography" text,
  "geographicFootprint" text,
  "geoScore" integer,
  "sector" text,
  "employees" integer,
  "employeeGroup" text,
  "revenueBand" text,
  "ownership" text,
  "successionRisk" text,
  "firmAge" integer,
  "coverageModel" text,
  "servicesFit" text,
  "mdPedigree" text,
  "balanceSheetPrincipal" text,
  "dealSizeMUsd" double precision,
  "dealsPerMdL3y" double precision,
  "feeGeneratingCount" integer,
  "hasSTOrBalanceSheet" boolean,
  "advisoryConflict" boolean,
  "webActivity" boolean,
  "solvent" boolean,
  "lifecycleState" text,
  "currentStage" text,
  "currentStep" text,
  "disposition" text,
  "lastReviewed" timestamptz,
  "scoreAtQualification" double precision,
  "tierAtQualification" text,
  "qualifiedAt" timestamptz,
  "enrichedBy" text,
  "enrichedAt" timestamptz,
  "outcome" text,
  "outcomeObservedAt" timestamptz,
  "outcomeSource" text,
  "discoveredViaSearchId" text
);
CREATE TABLE IF NOT EXISTS mandate (
  "mandateId" text PRIMARY KEY,
  "title" text,
  "intentStatement" text,
  "archetype" text,
  "priority" text,
  "active" boolean,
  "createdAt" timestamptz,
  "geographies" text[],
  "industries" text[],
  "products" text[],
  "sizeMaxUsdM" integer,
  "codename" text
);
CREATE TABLE IF NOT EXISTS search (
  "searchId" text PRIMARY KEY,
  "name" text,
  "mandateId" text,
  "geographies" text[],
  "industries" text[],
  "seedFirms" text[],
  "exclusions" text[],
  "breadth" text,
  "runAt" timestamptz,
  "runBy" text,
  "status" text,
  "resultCount" integer
);
CREATE TABLE IF NOT EXISTS search_list (
  "searchId" text PRIMARY KEY,
  "name" text,
  "mandateId" text,
  "filtersJson" text,
  "resultCount" integer,
  "requestedMore" boolean,
  "createdAt" timestamptz
);
CREATE TABLE IF NOT EXISTS search_membership (
  "membershipId" text PRIMARY KEY,
  "searchId" text,
  "firmId" text
);
CREATE TABLE IF NOT EXISTS research_finding (
  "findingId" text PRIMARY KEY,
  "firmId" text,
  "axis" text,
  "value" text,
  "normalizedScore" integer,
  "provider" text,
  "sourceType" text,
  "sourceUrl" text,
  "sourceExcerpt" text,
  "sourceDocumentId" text,
  "sourceQuote" text,
  "extractionModel" text,
  "confidence" double precision,
  "confidenceTier" text,
  "findingStatus" text,
  "verifiedByHuman" boolean,
  "verifiedBy" text,
  "verifiedAt" timestamptz,
  "conflictGroupId" text,
  "retrievedAt" timestamptz
);
CREATE TABLE IF NOT EXISTS extraction (
  "extractionId" text PRIMARY KEY,
  "firmId" text,
  "provider" text,
  "axis" text,
  "value" text,
  "quote" text,
  "model" text,
  "promptVersion" text,
  "documentsHash" text,
  "grounded" boolean,
  "rejectReason" text,
  "extractedAt" timestamptz
);
CREATE TABLE IF NOT EXISTS qualification_score (
  "scoreId" text PRIMARY KEY,
  "firmId" text,
  "model" text,
  "weightedTotal" double precision,
  "maxPossible" double precision,
  "pct" double precision,
  "tier" text,
  "confidence" double precision,
  "axisScoresJson" text,
  "thesisVersion" text,
  "rubricVersion" text,
  "computedBy" text,
  "computedAt" timestamptz
);
CREATE TABLE IF NOT EXISTS review_decision (
  "decisionId" text PRIMARY KEY,
  "firmId" text,
  "decisionType" text,
  "rejectionRationale" text,
  "scoreAtDecision" double precision,
  "tierAtDecision" text,
  "analystCategorization" text,
  "fieldsEnteredManually" text,
  "agentValuesOverridden" text,
  "decidedBy" text,
  "decidedAt" timestamptz
);
CREATE TABLE IF NOT EXISTS drift_event (
  "driftEventId" text PRIMARY KEY,
  "firmId" text,
  "priorTier" text,
  "priorScore" double precision,
  "newTier" text,
  "newScore" double precision,
  "changedAxes" text,
  "driftReason" text,
  "driftStatus" text,
  "resolution" text,
  "resolvedAt" timestamptz,
  "resolvedBy" text,
  "detectedAt" timestamptz
);
CREATE TABLE IF NOT EXISTS proposed_rule (
  "proposedRuleId" text PRIMARY KEY,
  "predicateAxis" text,
  "ruleOperator" text,
  "ruleThreshold" text,
  "ruleModel" text,
  "rationaleClusterSummary" text,
  "supportingFirmCount" integer,
  "supportingDecisionIds" text,
  "projectedScreenCount" integer,
  "ruleStatus" text,
  "ruleDecidedBy" text,
  "ruleDecidedAt" timestamptz,
  "proposedAt" timestamptz,
  "mandateScope" text
);
CREATE TABLE IF NOT EXISTS hard_screen_config (
  "configRuleId" text PRIMARY KEY,
  "configAxis" text,
  "configOperator" text,
  "configThreshold" text,
  "configModel" text,
  "configVersion" integer,
  "configActive" boolean,
  "configAuthor" text,
  "configCreatedAt" timestamptz,
  "sourceProposedRuleId" text
);
CREATE TABLE IF NOT EXISTS market_signal (
  "signalId" text PRIMARY KEY,
  "firmId" text,
  "kind" text,
  "effectiveDate" timestamptz,
  "headline" text,
  "axis" text,
  "newValue" text,
  "appliedAt" timestamptz,
  "effect" text
);
CREATE TABLE IF NOT EXISTS mandate_access (
  "accessId" text PRIMARY KEY,
  "mandateId" text,
  "persona" text
);
CREATE TABLE IF NOT EXISTS restricted_firm (
  "firmId" text PRIMARY KEY,
  "reason" text,
  "addedAt" timestamptz
);
CREATE TABLE IF NOT EXISTS access_log_entry (
  "entryId" text PRIMARY KEY,
  "persona" text,
  "objectType" text,
  "objectId" text,
  "viewedAt" timestamptz
);
CREATE TABLE IF NOT EXISTS action_run (
  "actionRunId" text PRIMARY KEY,
  "actionName" text,
  "startedAt" timestamptz,
  "durationMs" integer,
  "ok" boolean,
  "errorKind" text
);
CREATE TABLE IF NOT EXISTS model_call (
  "modelCallId" text PRIMARY KEY,
  "purpose" text,
  "model" text,
  "inputTokens" integer,
  "outputTokens" integer,
  "costUsd" double precision,
  "calledAt" timestamptz
);
CREATE TABLE IF NOT EXISTS search_list_firm ("searchId" text NOT NULL, "firmId" text NOT NULL, PRIMARY KEY ("searchId", "firmId"));
CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text, "updatedAt" timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS research_finding_firm ON research_finding ("firmId");
CREATE INDEX IF NOT EXISTS extraction_firm ON extraction ("firmId");
CREATE INDEX IF NOT EXISTS review_decision_firm ON review_decision ("firmId");
CREATE INDEX IF NOT EXISTS qualification_score_firm ON qualification_score ("firmId");
CREATE INDEX IF NOT EXISTS drift_event_firm ON drift_event ("firmId");
CREATE INDEX IF NOT EXISTS search_membership_search ON search_membership ("searchId");
CREATE INDEX IF NOT EXISTS market_signal_firm ON market_signal ("firmId");
CREATE INDEX IF NOT EXISTS market_signal_due ON market_signal ("effectiveDate") WHERE "appliedAt" IS NULL;

ALTER TABLE firm
  ADD COLUMN IF NOT EXISTS "firmId" text,
  ADD COLUMN IF NOT EXISTS "firmName" text,
  ADD COLUMN IF NOT EXISTS "source" text,
  ADD COLUMN IF NOT EXISTS "firmType" text,
  ADD COLUMN IF NOT EXISTS "hqCountry" text,
  ADD COLUMN IF NOT EXISTS "geography" text,
  ADD COLUMN IF NOT EXISTS "geographicFootprint" text,
  ADD COLUMN IF NOT EXISTS "geoScore" integer,
  ADD COLUMN IF NOT EXISTS "sector" text,
  ADD COLUMN IF NOT EXISTS "employees" integer,
  ADD COLUMN IF NOT EXISTS "employeeGroup" text,
  ADD COLUMN IF NOT EXISTS "revenueBand" text,
  ADD COLUMN IF NOT EXISTS "ownership" text,
  ADD COLUMN IF NOT EXISTS "successionRisk" text,
  ADD COLUMN IF NOT EXISTS "firmAge" integer,
  ADD COLUMN IF NOT EXISTS "coverageModel" text,
  ADD COLUMN IF NOT EXISTS "servicesFit" text,
  ADD COLUMN IF NOT EXISTS "mdPedigree" text,
  ADD COLUMN IF NOT EXISTS "balanceSheetPrincipal" text,
  ADD COLUMN IF NOT EXISTS "dealSizeMUsd" double precision,
  ADD COLUMN IF NOT EXISTS "dealsPerMdL3y" double precision,
  ADD COLUMN IF NOT EXISTS "feeGeneratingCount" integer,
  ADD COLUMN IF NOT EXISTS "hasSTOrBalanceSheet" boolean,
  ADD COLUMN IF NOT EXISTS "advisoryConflict" boolean,
  ADD COLUMN IF NOT EXISTS "webActivity" boolean,
  ADD COLUMN IF NOT EXISTS "solvent" boolean,
  ADD COLUMN IF NOT EXISTS "lifecycleState" text,
  ADD COLUMN IF NOT EXISTS "currentStage" text,
  ADD COLUMN IF NOT EXISTS "currentStep" text,
  ADD COLUMN IF NOT EXISTS "disposition" text,
  ADD COLUMN IF NOT EXISTS "lastReviewed" timestamptz,
  ADD COLUMN IF NOT EXISTS "scoreAtQualification" double precision,
  ADD COLUMN IF NOT EXISTS "tierAtQualification" text,
  ADD COLUMN IF NOT EXISTS "qualifiedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "enrichedBy" text,
  ADD COLUMN IF NOT EXISTS "enrichedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "outcome" text,
  ADD COLUMN IF NOT EXISTS "outcomeObservedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "outcomeSource" text,
  ADD COLUMN IF NOT EXISTS "discoveredViaSearchId" text;

ALTER TABLE mandate
  ADD COLUMN IF NOT EXISTS "mandateId" text,
  ADD COLUMN IF NOT EXISTS "title" text,
  ADD COLUMN IF NOT EXISTS "intentStatement" text,
  ADD COLUMN IF NOT EXISTS "archetype" text,
  ADD COLUMN IF NOT EXISTS "priority" text,
  ADD COLUMN IF NOT EXISTS "active" boolean,
  ADD COLUMN IF NOT EXISTS "createdAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "geographies" text[],
  ADD COLUMN IF NOT EXISTS "industries" text[],
  ADD COLUMN IF NOT EXISTS "products" text[],
  ADD COLUMN IF NOT EXISTS "sizeMaxUsdM" integer,
  ADD COLUMN IF NOT EXISTS "codename" text;

ALTER TABLE search
  ADD COLUMN IF NOT EXISTS "searchId" text,
  ADD COLUMN IF NOT EXISTS "name" text,
  ADD COLUMN IF NOT EXISTS "mandateId" text,
  ADD COLUMN IF NOT EXISTS "geographies" text[],
  ADD COLUMN IF NOT EXISTS "industries" text[],
  ADD COLUMN IF NOT EXISTS "seedFirms" text[],
  ADD COLUMN IF NOT EXISTS "exclusions" text[],
  ADD COLUMN IF NOT EXISTS "breadth" text,
  ADD COLUMN IF NOT EXISTS "runAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "runBy" text,
  ADD COLUMN IF NOT EXISTS "status" text,
  ADD COLUMN IF NOT EXISTS "resultCount" integer;

ALTER TABLE search_list
  ADD COLUMN IF NOT EXISTS "searchId" text,
  ADD COLUMN IF NOT EXISTS "name" text,
  ADD COLUMN IF NOT EXISTS "mandateId" text,
  ADD COLUMN IF NOT EXISTS "filtersJson" text,
  ADD COLUMN IF NOT EXISTS "resultCount" integer,
  ADD COLUMN IF NOT EXISTS "requestedMore" boolean,
  ADD COLUMN IF NOT EXISTS "createdAt" timestamptz;

ALTER TABLE search_membership
  ADD COLUMN IF NOT EXISTS "membershipId" text,
  ADD COLUMN IF NOT EXISTS "searchId" text,
  ADD COLUMN IF NOT EXISTS "firmId" text;

ALTER TABLE research_finding
  ADD COLUMN IF NOT EXISTS "findingId" text,
  ADD COLUMN IF NOT EXISTS "firmId" text,
  ADD COLUMN IF NOT EXISTS "axis" text,
  ADD COLUMN IF NOT EXISTS "value" text,
  ADD COLUMN IF NOT EXISTS "normalizedScore" integer,
  ADD COLUMN IF NOT EXISTS "provider" text,
  ADD COLUMN IF NOT EXISTS "sourceType" text,
  ADD COLUMN IF NOT EXISTS "sourceUrl" text,
  ADD COLUMN IF NOT EXISTS "sourceExcerpt" text,
  ADD COLUMN IF NOT EXISTS "sourceDocumentId" text,
  ADD COLUMN IF NOT EXISTS "sourceQuote" text,
  ADD COLUMN IF NOT EXISTS "extractionModel" text,
  ADD COLUMN IF NOT EXISTS "confidence" double precision,
  ADD COLUMN IF NOT EXISTS "confidenceTier" text,
  ADD COLUMN IF NOT EXISTS "findingStatus" text,
  ADD COLUMN IF NOT EXISTS "verifiedByHuman" boolean,
  ADD COLUMN IF NOT EXISTS "verifiedBy" text,
  ADD COLUMN IF NOT EXISTS "verifiedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "conflictGroupId" text,
  ADD COLUMN IF NOT EXISTS "retrievedAt" timestamptz;

ALTER TABLE extraction
  ADD COLUMN IF NOT EXISTS "extractionId" text,
  ADD COLUMN IF NOT EXISTS "firmId" text,
  ADD COLUMN IF NOT EXISTS "provider" text,
  ADD COLUMN IF NOT EXISTS "axis" text,
  ADD COLUMN IF NOT EXISTS "value" text,
  ADD COLUMN IF NOT EXISTS "quote" text,
  ADD COLUMN IF NOT EXISTS "model" text,
  ADD COLUMN IF NOT EXISTS "promptVersion" text,
  ADD COLUMN IF NOT EXISTS "documentsHash" text,
  ADD COLUMN IF NOT EXISTS "grounded" boolean,
  ADD COLUMN IF NOT EXISTS "rejectReason" text,
  ADD COLUMN IF NOT EXISTS "extractedAt" timestamptz;

ALTER TABLE qualification_score
  ADD COLUMN IF NOT EXISTS "scoreId" text,
  ADD COLUMN IF NOT EXISTS "firmId" text,
  ADD COLUMN IF NOT EXISTS "model" text,
  ADD COLUMN IF NOT EXISTS "weightedTotal" double precision,
  ADD COLUMN IF NOT EXISTS "maxPossible" double precision,
  ADD COLUMN IF NOT EXISTS "pct" double precision,
  ADD COLUMN IF NOT EXISTS "tier" text,
  ADD COLUMN IF NOT EXISTS "confidence" double precision,
  ADD COLUMN IF NOT EXISTS "axisScoresJson" text,
  ADD COLUMN IF NOT EXISTS "thesisVersion" text,
  ADD COLUMN IF NOT EXISTS "rubricVersion" text,
  ADD COLUMN IF NOT EXISTS "computedBy" text,
  ADD COLUMN IF NOT EXISTS "computedAt" timestamptz;

ALTER TABLE review_decision
  ADD COLUMN IF NOT EXISTS "decisionId" text,
  ADD COLUMN IF NOT EXISTS "firmId" text,
  ADD COLUMN IF NOT EXISTS "decisionType" text,
  ADD COLUMN IF NOT EXISTS "rejectionRationale" text,
  ADD COLUMN IF NOT EXISTS "scoreAtDecision" double precision,
  ADD COLUMN IF NOT EXISTS "tierAtDecision" text,
  ADD COLUMN IF NOT EXISTS "analystCategorization" text,
  ADD COLUMN IF NOT EXISTS "fieldsEnteredManually" text,
  ADD COLUMN IF NOT EXISTS "agentValuesOverridden" text,
  ADD COLUMN IF NOT EXISTS "decidedBy" text,
  ADD COLUMN IF NOT EXISTS "decidedAt" timestamptz;

ALTER TABLE drift_event
  ADD COLUMN IF NOT EXISTS "driftEventId" text,
  ADD COLUMN IF NOT EXISTS "firmId" text,
  ADD COLUMN IF NOT EXISTS "priorTier" text,
  ADD COLUMN IF NOT EXISTS "priorScore" double precision,
  ADD COLUMN IF NOT EXISTS "newTier" text,
  ADD COLUMN IF NOT EXISTS "newScore" double precision,
  ADD COLUMN IF NOT EXISTS "changedAxes" text,
  ADD COLUMN IF NOT EXISTS "driftReason" text,
  ADD COLUMN IF NOT EXISTS "driftStatus" text,
  ADD COLUMN IF NOT EXISTS "resolution" text,
  ADD COLUMN IF NOT EXISTS "resolvedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "resolvedBy" text,
  ADD COLUMN IF NOT EXISTS "detectedAt" timestamptz;

ALTER TABLE proposed_rule
  ADD COLUMN IF NOT EXISTS "proposedRuleId" text,
  ADD COLUMN IF NOT EXISTS "predicateAxis" text,
  ADD COLUMN IF NOT EXISTS "ruleOperator" text,
  ADD COLUMN IF NOT EXISTS "ruleThreshold" text,
  ADD COLUMN IF NOT EXISTS "ruleModel" text,
  ADD COLUMN IF NOT EXISTS "rationaleClusterSummary" text,
  ADD COLUMN IF NOT EXISTS "supportingFirmCount" integer,
  ADD COLUMN IF NOT EXISTS "supportingDecisionIds" text,
  ADD COLUMN IF NOT EXISTS "projectedScreenCount" integer,
  ADD COLUMN IF NOT EXISTS "ruleStatus" text,
  ADD COLUMN IF NOT EXISTS "ruleDecidedBy" text,
  ADD COLUMN IF NOT EXISTS "ruleDecidedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "proposedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "mandateScope" text;

ALTER TABLE hard_screen_config
  ADD COLUMN IF NOT EXISTS "configRuleId" text,
  ADD COLUMN IF NOT EXISTS "configAxis" text,
  ADD COLUMN IF NOT EXISTS "configOperator" text,
  ADD COLUMN IF NOT EXISTS "configThreshold" text,
  ADD COLUMN IF NOT EXISTS "configModel" text,
  ADD COLUMN IF NOT EXISTS "configVersion" integer,
  ADD COLUMN IF NOT EXISTS "configActive" boolean,
  ADD COLUMN IF NOT EXISTS "configAuthor" text,
  ADD COLUMN IF NOT EXISTS "configCreatedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "sourceProposedRuleId" text;

ALTER TABLE market_signal
  ADD COLUMN IF NOT EXISTS "signalId" text,
  ADD COLUMN IF NOT EXISTS "firmId" text,
  ADD COLUMN IF NOT EXISTS "kind" text,
  ADD COLUMN IF NOT EXISTS "effectiveDate" timestamptz,
  ADD COLUMN IF NOT EXISTS "headline" text,
  ADD COLUMN IF NOT EXISTS "axis" text,
  ADD COLUMN IF NOT EXISTS "newValue" text,
  ADD COLUMN IF NOT EXISTS "appliedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "effect" text;

ALTER TABLE mandate_access
  ADD COLUMN IF NOT EXISTS "accessId" text,
  ADD COLUMN IF NOT EXISTS "mandateId" text,
  ADD COLUMN IF NOT EXISTS "persona" text;

ALTER TABLE restricted_firm
  ADD COLUMN IF NOT EXISTS "firmId" text,
  ADD COLUMN IF NOT EXISTS "reason" text,
  ADD COLUMN IF NOT EXISTS "addedAt" timestamptz;

ALTER TABLE access_log_entry
  ADD COLUMN IF NOT EXISTS "entryId" text,
  ADD COLUMN IF NOT EXISTS "persona" text,
  ADD COLUMN IF NOT EXISTS "objectType" text,
  ADD COLUMN IF NOT EXISTS "objectId" text,
  ADD COLUMN IF NOT EXISTS "viewedAt" timestamptz;

ALTER TABLE action_run
  ADD COLUMN IF NOT EXISTS "actionRunId" text,
  ADD COLUMN IF NOT EXISTS "actionName" text,
  ADD COLUMN IF NOT EXISTS "startedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "durationMs" integer,
  ADD COLUMN IF NOT EXISTS "ok" boolean,
  ADD COLUMN IF NOT EXISTS "errorKind" text;

ALTER TABLE model_call
  ADD COLUMN IF NOT EXISTS "modelCallId" text,
  ADD COLUMN IF NOT EXISTS "purpose" text,
  ADD COLUMN IF NOT EXISTS "model" text,
  ADD COLUMN IF NOT EXISTS "inputTokens" integer,
  ADD COLUMN IF NOT EXISTS "outputTokens" integer,
  ADD COLUMN IF NOT EXISTS "costUsd" double precision,
  ADD COLUMN IF NOT EXISTS "calledAt" timestamptz;

/**
 * The schema as the runtime `ensureSchema` step created it before numbered migrations: the
 * output of the old `ddl()` at the time of the change, kept verbatim. The migration tests apply it
 * to stand in for the production database the baseline migration has to adopt.
 */
export const LEGACY_SCHEMA_SQL = `
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
`;

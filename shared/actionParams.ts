/**
 * The parameters of every action, declared once. The server validates raw JSON against these specs
 * (server/actions/params.ts) and the client's `useOsdkAction` takes the matching typed object, so
 * the two cannot drift apart. Object-typed parameters travel as primary keys: the client passes the
 * key, the server loads the row before the action runs.
 */
import type { ActionName, ObjectOf, ObjectTypeName } from "./schema.js";

export type ParamType =
  | "string"
  | "integer"
  | "double"
  | "boolean"
  | "timestamp"
  | "string[]"
  | { readonly object: ObjectTypeName };

export interface ParamDef {
  readonly type: ParamType;
  readonly nullable?: boolean;
}

export type ParamSpec = Readonly<Record<string, ParamDef>>;

const firm = { type: { object: "Firm" } } as const;
const driftEvent = { type: { object: "DriftEvent" } } as const;
const proposedRule = { type: { object: "ProposedRule" } } as const;
const finding = { type: { object: "ResearchFinding" } } as const;
const optional = <T extends Exclude<ParamType, { readonly object: ObjectTypeName }>>(type: T) =>
  ({ type, nullable: true }) as const;

export const ACTION_PARAMS = {
  runMandateSearch: {
    title: { type: "string" },
    archetype: { type: "string" },
    geographies: optional("string[]"),
    priority: optional("string"),
    sizeMaxUsdM: optional("integer"),
  },
  runSearch: {
    mandate: { type: { object: "Mandate" } },
    geographies: optional("string[]"),
    industries: optional("string[]"),
    seedFirms: optional("string[]"),
    exclusions: optional("string[]"),
    breadth: optional("string"),
  },
  runAgentEnrichment: { firm },
  enrichFirm: {
    firm,
    servicesFit: optional("string"),
    mdPedigree: optional("string"),
    balanceSheetPrincipal: optional("string"),
    dealSizeMUsd: optional("double"),
    dealsPerMdL3y: optional("double"),
    firmAge: optional("integer"),
    feeGeneratingCount: optional("integer"),
    advisoryConflict: optional("boolean"),
    hasStOrBalanceSheet: optional("boolean"),
    webActivity: optional("boolean"),
    solvent: optional("boolean"),
    employees: optional("integer"),
    coverageModel: optional("string"),
    fieldsEnteredManually: optional("string"),
    agentValuesOverridden: optional("string"),
  },
  verifyFinding: {
    finding,
    overrideValue: optional("string"),
    overrideNormalizedScore: optional("integer"),
  },
  resolveConflict: {
    chosenFinding: finding,
    rejectedFinding: finding,
    chosenValue: { type: "string" },
  },
  qualifyFirm: { firm },
  rejectFirm: { firm, rejectionRationale: { type: "string" } },
  advanceStage: { firm, targetState: { type: "string" } },
  setFirmOutcome: {
    firm,
    outcome: { type: "string" },
    outcomeObservedAt: { type: "timestamp" },
  },
  reEngageFirm: { firm, driftEvent },
  keepPassed: { driftEvent, rationale: { type: "string" } },
  acknowledgeDrift: { driftEvent, note: optional("string") },
  clusterRejections: {},
  approveRule: { proposedRule },
  dismissRule: { proposedRule, reason: { type: "string" } },
  unapproveRule: { proposedRule },
  amendRuleThreshold: {
    proposedRule,
    newThreshold: { type: "string" },
    newOperator: optional("string"),
  },
} as const satisfies { readonly [N in ActionName]: ParamSpec };

type Specs = typeof ACTION_PARAMS;

/** How a side of the wire holds the two parameter kinds that are not plain values. */
interface Side {
  objects: Record<ObjectTypeName, unknown>;
  list: unknown;
  /** What a parameter left out reads as. */
  absent: unknown;
}

type ValueOf<T extends ParamType, S extends Side> = T extends "string" | "timestamp"
  ? string
  : T extends "integer" | "double"
    ? number
    : T extends "boolean"
      ? boolean
      : T extends "string[]"
        ? S["list"]
        : T extends { readonly object: infer O extends ObjectTypeName }
          ? S["objects"][O]
          : never;

type OptionalKeys<P extends ParamSpec> = {
  [K in keyof P]: P[K] extends { readonly nullable: true } ? K : never;
}[keyof P];

type Build<P extends ParamSpec, S extends Side> = keyof P extends never
  ? Record<string, never>
  : {
      [K in Exclude<keyof P, OptionalKeys<P>>]: ValueOf<P[K]["type"], S>;
    } & {
      [K in OptionalKeys<P>]?: ValueOf<P[K]["type"], S> | S["absent"];
    };

/** What a caller passes to an action: object parameters as primary keys, gaps as `null`. */
export type ActionParams<N extends ActionName> = Build<
  Specs[N],
  { objects: Record<ObjectTypeName, string>; list: readonly string[]; absent: null }
>;

/** What an action's `run` receives once the server has validated the JSON and loaded the objects. */
export type ResolvedParams<N extends ActionName> = Build<
  Specs[N],
  { objects: { [O in ObjectTypeName]: ObjectOf<O> }; list: string[]; absent: undefined }
>;

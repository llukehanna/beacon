/**
 * A rubric is data: traits say what can be known about a firm, a rubric
 * definition says how each thesis scores those traits. One generic engine
 * (engine.ts) interprets any definition, in the browser and on the server.
 */
import type { Operator } from "../vocab.js";

export type TraitValue = string | number | boolean;
export type Traits = Readonly<Record<string, TraitValue>>;
export type TraitKind = "category" | "number" | "yesno";

export interface TraitDef {
  traitKey: string;
  label: string;
  description: string;
  unit: string | null;
  kind: TraitKind;
  /** Whether the enrichment agent researches it. */
  enrichable: boolean;
}

export interface Band {
  min?: number;
  max?: number;
  minInclusive: boolean;
  maxInclusive: boolean;
  points: number;
  label: string;
}

export type Scoring =
  | { type: "category"; options: { value: string; points: number }[] }
  | { type: "bands"; bands: Band[] }
  /** The value is the points, clamped to [min, max]. */
  | { type: "direct"; min: number; max: number };

export interface Criterion {
  traitKey: string;
  label: string;
  weight: number;
  scoring: Scoring;
}

export interface HardReject {
  traitKey: string;
  operator: Operator;
  value: string;
  reason: string;
}

export type Tier = "A" | "B" | "C" | "Rejected";
export type Action = "Outreach" | "Follow" | "Enrich" | "Reject";

export interface ThesisDef {
  key: string;
  label: string;
  /** Search product groups that select this thesis. */
  productGroups: string[];
  criteria: Criterion[];
  hardRejects: HardReject[];
  /** Minimum weighted points per tier. */
  tiers: { A: number; B: number; C: number };
  actions: {
    A: Action;
    B: Action;
    C: Action;
    Rejected: Action;
    upgrades: { tier: "A" | "B" | "C"; minPoints: number; action: Action }[];
  };
}

/** A screening rule the keyword heuristic may propose from rejection rationales. */
export interface CandidateScreen {
  axis: string;
  operator: Operator;
  threshold: string;
  /** Case-insensitive RegExp source matched against rationales. */
  keywords: string;
  summary: string;
}

export interface RubricDefinition {
  defaultThesis: string;
  theses: ThesisDef[];
  candidateScreens: CandidateScreen[];
}

export interface AxisScore {
  axis: string;
  score: number;
  band: string;
  known: boolean;
}

export interface ScoreResult {
  /** The thesis key the firm was scored under. */
  model: string;
  hardRejected: boolean;
  rejectReason: string;
  weightedTotal: number;
  maxPossible: number;
  pct: number;
  tier: Tier;
  action: Action;
  confidence: number;
  axisScores: AxisScore[];
}

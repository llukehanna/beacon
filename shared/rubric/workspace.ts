import type { WorkspaceDefinition } from "../workspaces/types.js";
import { RubricError, parseRubricDefinition } from "./definition.js";
import type { TraitValue } from "./types.js";

/**
 * Check a workspace's rubric against its trait catalog. Profile fields are
 * descriptive by design (ADR 0010), so the rubric may not score or reject on them.
 */
export function validateWorkspace(ws: WorkspaceDefinition): void {
  parseRubricDefinition(ws.rubric);
  const problems: string[] = [];
  const byKey = new Map(ws.traits.map((t) => [t.traitKey, t]));
  if (byKey.size !== ws.traits.length) {
    problems.push("trait keys must be unique");
  }
  const scorable = (where: string, key: string) => {
    const t = byKey.get(key);
    if (!t) {
      problems.push(`${where} names undeclared trait "${key}"`);
    } else if (t.role === "profile") {
      problems.push(`${where} uses profile trait "${key}", which is never scored`);
    }
    return t;
  };
  for (const thesis of ws.rubric.theses) {
    for (const c of thesis.criteria) {
      const t = scorable(`Thesis "${thesis.key}" criterion`, c.traitKey);
      if (!t) {
        continue;
      }
      const wants = c.scoring.type === "category" ? "category" : "number";
      if (t.kind !== wants) {
        problems.push(`Criterion "${c.label}" scores ${t.kind} trait "${t.traitKey}" as ${wants}`);
      }
      if (c.scoring.type === "category") {
        const vocab = new Set((t.options ?? []).map((o) => o.trim().toLowerCase()));
        for (const o of c.scoring.options) {
          if (!vocab.has(o.value.trim().toLowerCase())) {
            problems.push(`Option "${o.value}" is not in trait "${t.traitKey}"'s vocabulary`);
          }
        }
      }
    }
    for (const r of thesis.hardRejects) {
      scorable(`Thesis "${thesis.key}" hard reject`, r.traitKey);
    }
  }
  for (const s of ws.rubric.candidateScreens) {
    scorable("Candidate screen", s.axis);
  }
  if (problems.length > 0) {
    throw new RubricError(`Invalid workspace "${ws.key}": ${problems.join("; ")}`);
  }
}

/** A firm row's non-empty legacy columns, keyed by trait. */
export function legacyTraits(
  ws: WorkspaceDefinition,
  row: Readonly<Record<string, unknown>>,
): Record<string, TraitValue> {
  const out: Record<string, TraitValue> = {};
  for (const [field, key] of Object.entries(ws.legacyFields)) {
    const v = row[field];
    if (
      typeof v === "string" ||
      typeof v === "boolean" ||
      (typeof v === "number" && Number.isFinite(v))
    ) {
      out[key] = v;
    }
  }
  return out;
}

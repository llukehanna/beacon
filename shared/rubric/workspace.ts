import type { WorkspaceDefinition } from "../workspaces/types.js";
import { RubricError, parseRubricDefinition } from "./definition.js";

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
  for (const t of ws.traits) {
    if (t.wholeNumber && t.kind !== "number") {
      problems.push(`Trait "${t.traitKey}" counts whole numbers but is a ${t.kind} trait`);
    }
  }
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
  const thesisKeys = new Set(ws.rubric.theses.map((t) => t.key));
  for (const t of ws.traits) {
    for (const k of t.theses ?? []) {
      if (!thesisKeys.has(k)) {
        problems.push(`Trait "${t.traitKey}" names undeclared thesis "${k}"`);
      }
    }
  }
  for (const s of ws.rubric.candidateScreens) {
    scorable("Candidate screen", s.axis);
  }
  if (problems.length > 0) {
    throw new RubricError(`Invalid workspace "${ws.key}": ${problems.join("; ")}`);
  }
}

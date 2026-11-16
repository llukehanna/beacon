import { z } from "zod";
import { OPERATORS } from "../vocab.js";
import type { RubricDefinition } from "./types.js";

export class RubricError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RubricError";
  }
}

const action = z.enum(["Outreach", "Follow", "Enrich", "Reject"]);
const finite = z.number().finite();

const band = z
  .object({
    min: finite.optional(),
    max: finite.optional(),
    minInclusive: z.boolean(),
    maxInclusive: z.boolean(),
    points: finite,
    label: z.string().min(1),
  })
  .strict();

const scoring = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("category"),
      options: z.array(z.object({ value: z.string().min(1), points: finite }).strict()).min(1),
    })
    .strict(),
  z.object({ type: z.literal("bands"), bands: z.array(band).min(1) }).strict(),
  z.object({ type: z.literal("direct"), min: finite, max: finite }).strict(),
]);

const thesis = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    productGroups: z.array(z.string()),
    criteria: z
      .array(
        z
          .object({
            traitKey: z.string().min(1),
            label: z.string().min(1),
            weight: finite.positive(),
            scoring,
          })
          .strict(),
      )
      .min(1),
    hardRejects: z.array(
      z
        .object({
          traitKey: z.string().min(1),
          operator: z.enum(OPERATORS),
          value: z.string(),
          reason: z.string().min(1),
        })
        .strict(),
    ),
    tiers: z.object({ A: finite, B: finite, C: finite }).strict(),
    actions: z
      .object({
        A: action,
        B: action,
        C: action,
        Rejected: action,
        upgrades: z.array(
          z.object({ tier: z.enum(["A", "B", "C"]), minPoints: finite, action }).strict(),
        ),
      })
      .strict(),
  })
  .strict();

const definition = z
  .object({
    defaultThesis: z.string().min(1),
    theses: z.array(thesis).min(1),
    candidateScreens: z.array(
      z
        .object({
          axis: z.string().min(1),
          operator: z.enum(OPERATORS),
          threshold: z.string(),
          keywords: z.string().min(1),
          summary: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((d, ctx) => {
    const keys = d.theses.map((t) => t.key.trim().toLowerCase());
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: "custom", message: "Thesis keys must be unique" });
    }
    if (!keys.includes(d.defaultThesis.trim().toLowerCase())) {
      ctx.addIssue({
        code: "custom",
        message: `defaultThesis "${d.defaultThesis}" is not declared`,
      });
    }
    for (const t of d.theses) {
      const seen = new Set<string>();
      for (const c of t.criteria) {
        if (seen.has(c.traitKey)) {
          ctx.addIssue({
            code: "custom",
            message: `Thesis "${t.key}" scores ${c.traitKey} more than once`,
          });
        }
        seen.add(c.traitKey);
      }
      if (!(t.tiers.A >= t.tiers.B && t.tiers.B >= t.tiers.C)) {
        ctx.addIssue({
          code: "custom",
          message: `Thesis "${t.key}" tiers must satisfy A >= B >= C`,
        });
      }
    }
  });

/** Validate an untrusted rubric document; throws RubricError listing every problem. */
export function parseRubricDefinition(json: unknown): RubricDefinition {
  const r = definition.safeParse(json);
  if (!r.success) {
    const issues = r.error.issues.map(
      (i) => (i.path.length ? `${i.path.join(".")}: ` : "") + i.message,
    );
    throw new RubricError(`Invalid rubric definition: ${issues.join("; ")}`);
  }
  return r.data;
}

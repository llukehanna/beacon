import type { RubricDefinition } from "../types.js";

/**
 * A deliberately unfamiliar rubric: weighted, non-monotonic, direct-scored,
 * two theses, different tiers. Tests use it to prove the engine and the desk
 * modules assume nothing about the advisory-acquisitions workspace.
 */
export const TOY: RubricDefinition = {
  defaultThesis: "growth",
  candidateScreens: [],
  theses: [
    {
      key: "growth",
      label: "Growth",
      productGroups: ["Growth equity"],
      criteria: [
        {
          traitKey: "product_quality",
          label: "Product",
          weight: 3,
          scoring: {
            type: "category",
            options: [
              { value: "Toxic", points: 0 },
              { value: "Poor", points: 0 },
              { value: "OK", points: 1 },
              { value: "Great", points: 2 },
            ],
          },
        },
        {
          traitKey: "team_size",
          label: "Team",
          weight: 1,
          scoring: {
            type: "bands",
            bands: [
              { max: 5, minInclusive: true, maxInclusive: false, points: 0, label: "<5" },
              { min: 5, max: 20, minInclusive: true, maxInclusive: true, points: 2, label: "5-20" },
              { min: 20, minInclusive: false, maxInclusive: true, points: 1, label: ">20" },
            ],
          },
        },
        {
          traitKey: "region_fit",
          label: "Region",
          weight: 1,
          scoring: { type: "direct", min: 0, max: 3 },
        },
      ],
      hardRejects: [
        { traitKey: "sanctioned", operator: "==", value: "true", reason: "Sanctioned entity" },
        { traitKey: "product_quality", operator: "==", value: "toxic", reason: "Toxic product" },
      ],
      tiers: { A: 10, B: 6, C: 3 },
      actions: {
        A: "Outreach",
        B: "Follow",
        C: "Follow",
        Rejected: "Enrich",
        upgrades: [{ tier: "B", minPoints: 8, action: "Outreach" }],
      },
    },
    {
      key: "value",
      label: "Value",
      productGroups: ["Buyout"],
      criteria: [
        {
          traitKey: "product_quality",
          label: "Product",
          weight: 1,
          scoring: {
            type: "category",
            options: [
              { value: "OK", points: 1 },
              { value: "Great", points: 2 },
            ],
          },
        },
      ],
      hardRejects: [],
      tiers: { A: 2, B: 1, C: 1 },
      actions: { A: "Outreach", B: "Follow", C: "Follow", Rejected: "Enrich", upgrades: [] },
    },
  ],
};

import type { RubricContext, RubricDefinition, TraitDef } from "../types.js";

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

/** The toy rubric's trait catalog: researched traits, a gate, a fact and a profile trait. */
export const TOY_TRAITS: TraitDef[] = [
  {
    traitKey: "product_quality",
    label: "Product quality",
    description: "How good the product is",
    unit: null,
    kind: "category",
    role: "evidence",
    options: ["Toxic", "Poor", "OK", "Great"],
    passWhen: null,
    theses: null,
  },
  {
    traitKey: "team_size",
    label: "Team size",
    description: "People on the team",
    unit: "people",
    kind: "number",
    role: "evidence",
    options: null,
    passWhen: null,
    theses: ["growth"],
  },
  {
    traitKey: "sanctioned",
    label: "Sanctions screen",
    description: "Appears on a sanctions list",
    unit: null,
    kind: "yesno",
    role: "evidence",
    options: null,
    passWhen: false,
    theses: null,
  },
  {
    traitKey: "region_fit",
    label: "Region fit",
    description: "Fit of the home region, 0 to 3",
    unit: null,
    kind: "number",
    role: "fact",
    options: null,
    passWhen: null,
    theses: null,
  },
  {
    traitKey: "stage",
    label: "Funding stage",
    description: "Latest round",
    unit: null,
    kind: "category",
    role: "profile",
    options: ["Seed", "Series A", "Series B"],
    passWhen: null,
    theses: null,
  },
];

/** The toy rubric with its catalog, as the shared models take it. */
export const TOY_RUBRIC: RubricContext = { definition: TOY, traits: TOY_TRAITS };

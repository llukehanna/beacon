/**
 * The engine, the screens and the server read traits and scoring as data. Only a few places may
 * know the advisory-acquisitions workspace by name: the workspace itself, the seed and the mock
 * agent paths that generate its demo data, the offline tooling, the test factory, and tests. This test fails when team vocabulary leaks anywhere else.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DIRS = ["api", "server", "shared", "src", "scripts", "worker"];

/** Where a concrete workspace and its vocabulary may appear. */
const ALLOWED: readonly RegExp[] = [
  /^shared\/workspaces\//,
  /^shared\/rubric\/__fixtures__\//,
  /^shared\/rubric\/__oracle__\//,
  /^server\/seed\//,
  /^server\/enrichment\//,
  /^server\/extraction\//,
  /^server\/eval\//,
  /^server\/testing\.ts$/,
  /^scripts\//,
  /\.test\.tsx?$/,
];

/** An import of a concrete workspace (the WorkspaceDefinition type is generic). */
const WORKSPACE_IMPORT = /from\s+["'][^"']*\bworkspaces\/(?!types(?:\.js)?["'])[^"']*["']/;
const ORACLE_IMPORT = /from\s+["'][^"']*__oracle__[^"']*["']/;
const VOCAB =
  /\b(CF_SERVICES_LABELS|CF_MD_LABELS|CS_[A-Z][A-Z_]*|COVERAGE_LABELS|PRODUCT_FIRM_TYPE|ENRICH_AXES|scoreMirror)\b/;

function sources(dir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string): void => {
    for (const name of readdirSync(abs)) {
      if (name === "node_modules" || name.startsWith(".")) {
        continue;
      }
      const path = join(abs, name);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (/\.tsx?$/.test(name)) {
        out.push(relative(ROOT, path).split(sep).join("/"));
      }
    }
  };
  try {
    walk(join(ROOT, dir));
  } catch {
    // A directory this checkout does not have.
  }
  return out;
}

/** Each offending line in a file the rules cover: `path:line: text`. */
export function leaks(
  files: readonly { path: string; text: string }[],
  allowed: readonly RegExp[] = ALLOWED,
): string[] {
  const found: string[] = [];
  for (const { path, text } of files) {
    const isTest = /\.test\.tsx?$/.test(path);
    const isAllowed = allowed.some((r) => r.test(path));
    text.split("\n").forEach((line, i) => {
      const hit =
        (!isAllowed && (WORKSPACE_IMPORT.test(line) || VOCAB.test(line))) ||
        (!isTest && !/^shared\/rubric\/__oracle__\//.test(path) && ORACLE_IMPORT.test(line));
      if (hit) {
        found.push(`${path}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  return found;
}

/**
 * The firm columns migration 0006 dropped. A trait is read from the firm's trait values by its key;
 * the old names survive only in the workspace's alias map, the frozen fixtures and oracle, the
 * migrations, the test factory and tests. (employees, solvent and ownership are trait keys too.)
 */
const DROPPED_COLUMN =
  /\b(firmType|servicesFit|mdPedigree|balanceSheetPrincipal|dealSizeMUsd|dealsPerMdL3y|firmAge|feeGeneratingCount|advisoryConflict|hasS[Tt]OrBalanceSheet|webActivity|coverageModel|geoScore|revenueBand|successionRisk)\b/;

const COLUMN_ALLOWED: readonly RegExp[] = [
  /^shared\/workspaces\//,
  /^shared\/rubric\/__fixtures__\//,
  /^shared\/rubric\/__oracle__\//,
  /^server\/db\/migrations\.generated\.ts$/,
  /^server\/db\/legacySchema\.fixture\.ts$/,
  /^server\/testing\.ts$/,
  /\.test\.tsx?$/,
];

/** Each line outside the allowed places that names a dropped firm column: `path:line: text`. */
export function columnLeaks(files: readonly { path: string; text: string }[]): string[] {
  const found: string[] = [];
  for (const { path, text } of files) {
    if (COLUMN_ALLOWED.some((r) => r.test(path))) {
      continue;
    }
    text.split("\n").forEach((line, i) => {
      if (DROPPED_COLUMN.test(line)) {
        found.push(`${path}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  return found;
}

describe("team vocabulary stays in the workspace", () => {
  const files = DIRS.flatMap(sources).map((path) => ({
    path,
    text: readFileSync(join(ROOT, path), "utf8"),
  }));

  it("reads every source directory", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it("finds no workspace import, oracle import or team constant outside the allowed places", () => {
    expect(leaks(files)).toEqual([]);
  });

  it("would catch each kind of leak", () => {
    const planted = [
      {
        path: "src/desk/x.ts",
        text: 'import { ADVISORY_ACQUISITIONS } from "../../shared/workspaces/advisoryAcquisitions";',
      },
      {
        path: "shared/y.ts",
        text: 'import { ADVISORY_ACQUISITIONS } from "./workspaces/advisoryAcquisitions.js";',
      },
      { path: "server/actions/x.ts", text: "const labels = CS_MD_LABELS;" },
      {
        path: "server/seed/x.ts",
        text: 'import { mirrorScore } from "../rubric/__oracle__/a.js";',
      },
      {
        path: "shared/x.ts",
        text: 'import type { WorkspaceDefinition } from "./workspaces/types.js";',
      },
    ];
    expect(leaks(planted).map((l) => l.split(":")[0])).toEqual([
      "src/desk/x.ts",
      "shared/y.ts",
      "server/actions/x.ts",
      "server/seed/x.ts",
    ]);
  });
});

describe("the dropped firm columns stay dropped", () => {
  const files = DIRS.flatMap(sources).map((path) => ({
    path,
    text: readFileSync(join(ROOT, path), "utf8"),
  }));

  it("finds no dropped column name outside the allowed places", () => {
    expect(columnLeaks(files)).toEqual([]);
  });

  it("would catch a read of a dropped column", () => {
    const planted = [
      { path: "src/desk/x.tsx", text: "const size = firm.dealSizeMUsd;" },
      { path: "server/seed/x.ts", text: 'row.firmType = "CF";' },
      { path: "server/functions/x.ts", text: "const n = firm.traits.employees;" },
      { path: "shared/workspaces/x.ts", text: 'firmAge: "firm_age",' },
    ];
    expect(columnLeaks(planted).map((l) => l.split(":")[0])).toEqual([
      "src/desk/x.tsx",
      "server/seed/x.ts",
    ]);
  });
});

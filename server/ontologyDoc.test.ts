import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderOntology } from "../shared/ontologyDoc";
import { ACTION_NAMES, LINKS, OBJECT_TYPES, type ObjectTypeDef } from "../shared/schema";
import { MAX_LIST, MAX_LIST_ITEM, MAX_STRING } from "./actions/params";
import { ACTIONS } from "./actions/registry";

const LIMITS = { maxString: MAX_STRING, maxList: MAX_LIST, maxListItem: MAX_LIST_ITEM };
const doc = renderOntology(ACTIONS, LIMITS);

describe("the generated ontology reference", () => {
  it("lists every object type with its table, primary key and each property and type", () => {
    for (const [name, def] of Object.entries(OBJECT_TYPES)) {
      expect(doc, name).toContain(`### ${name}\n`);
      expect(doc, name).toContain(`Table \`${def.table}\`, primary key \`${def.primaryKey}\``);
      for (const [prop, type] of Object.entries<string>(def.properties)) {
        expect(doc, `${name}.${prop}`).toContain(`| \`${prop}\` | ${type} |`);
      }
    }
  });

  it("marks the primary key and each required property", () => {
    for (const [name, def] of Object.entries(OBJECT_TYPES)) {
      const section = doc.slice(doc.indexOf(`### ${name}\n`)).split("\n### ")[0];
      expect(section, `${name} key`).toContain(`| \`${def.primaryKey}\` | string | primary key |`);
      const required = (def as ObjectTypeDef).required ?? [];
      for (const [prop, type] of Object.entries<string>(def.properties)) {
        if (required.includes(prop)) {
          expect(section, `${name}.${prop}`).toContain(`| \`${prop}\` | ${type} | required |`);
        }
      }
      expect(section.match(/\| required \|/g)?.length ?? 0, `${name} required count`).toBe(
        required.length,
      );
    }
  });

  it("lists every link", () => {
    for (const l of LINKS) {
      expect(doc).toContain(`| ${l.source} | \`${l.name}\` | ${l.target} | \`${l.joinTable}\` |`);
    }
  });

  it("lists every action with each parameter, its type and whether it is required", () => {
    for (const name of ACTION_NAMES) {
      expect(doc, name).toContain(`### ${name}\n`);
      for (const [param, def] of Object.entries(ACTIONS[name]!.params)) {
        const type = typeof def.type === "object" ? `${def.type.object} (primary key)` : def.type;
        expect(doc, `${name}.${param}`).toContain(
          `| \`${param}\` | ${type} | ${def.nullable === true ? "no" : "yes"} |`,
        );
      }
    }
  });

  it("states the parameter bounds the server enforces", () => {
    expect(doc).toContain(
      `at most ${MAX_STRING.toLocaleString("en-US")} characters, and a list holds at most ${MAX_LIST} strings of at most ${MAX_LIST_ITEM} characters`,
    );
  });

  it("refuses to render when a named action has no definition", () => {
    expect(() => renderOntology({}, LIMITS)).toThrow(/has no definition/);
  });

  it("is what docs/ontology.md contains (run npm run ontology:doc after changing the schema)", () => {
    expect(readFileSync(resolve(__dirname, "../docs/ontology.md"), "utf8")).toBe(doc);
  });
});

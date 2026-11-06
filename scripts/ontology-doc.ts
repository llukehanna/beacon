import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MAX_LIST, MAX_LIST_ITEM, MAX_STRING } from "../server/actions/params.js";
import { ACTIONS } from "../server/actions/registry.js";
import { renderOntology } from "../shared/ontologyDoc.js";

// Writes docs/ontology.md from shared/schema.ts and the action registry. `--check` writes nothing
// and exits non-zero when the committed file is not what the generator would write.
const check = process.argv.includes("--check");
const file = fileURLToPath(new URL("../docs/ontology.md", import.meta.url));
const fresh = renderOntology(ACTIONS, {
  maxString: MAX_STRING,
  maxList: MAX_LIST,
  maxListItem: MAX_LIST_ITEM,
});

if (check) {
  if (!existsSync(file) || readFileSync(file, "utf8") !== fresh) {
    console.error("docs/ontology.md is out of date. Run `npm run ontology:doc` and commit it.");
    process.exit(1);
  }
  console.log("docs/ontology.md is up to date");
} else {
  writeFileSync(file, fresh);
  console.log("wrote docs/ontology.md");
}

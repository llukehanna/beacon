import { validateWorkspace } from "../../shared/rubric/workspace.js";
import type { WorkspaceDefinition } from "../../shared/workspaces/types.js";
import type { Queryable } from "../db/client.js";
import { insertObjects } from "../db/repo.js";

/** Write a workspace's trait catalog and its rubric as version 1, the active one. */
export async function seedWorkspace(
  q: Queryable,
  ws: WorkspaceDefinition,
  now: string,
): Promise<void> {
  validateWorkspace(ws);
  await insertObjects(
    q,
    "Trait",
    ws.traits.map((t, position) => ({
      traitId: `${ws.key}:${t.traitKey}`,
      workspaceKey: ws.key,
      traitKey: t.traitKey,
      label: t.label,
      description: t.description,
      unit: t.unit,
      kind: t.kind,
      role: t.role,
      optionsJson: t.options === null ? null : JSON.stringify(t.options),
      passWhen: t.passWhen,
      thesesJson: t.theses === null ? null : JSON.stringify(t.theses),
      position,
    })),
  );
  await insertObjects(q, "Rubric", [
    {
      rubricId: `${ws.key}@1`,
      workspaceKey: ws.key,
      version: 1,
      name: `${ws.name} rubric v1`,
      active: true,
      definitionJson: JSON.stringify(ws.rubric),
      createdBy: "seed",
      createdAt: now,
    },
  ]);
}

import { expect, test } from "@playwright/test";

/** A JSON-RPC round trip against the dev server's seeded demo: what an MCP client would do. */

let nextId = 1;
const rpc = (method: string, params?: object) => ({ jsonrpc: "2.0", id: nextId++, method, params });

test("an MCP client can initialize, list the tools and read a firm's evidence", async ({
  request,
}) => {
  const init = await request.post("/api/mcp", {
    data: rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "e2e", version: "0.0.0" },
    }),
  });
  expect(init.status()).toBe(200);
  expect(init.headers()["content-type"]).toContain("application/json");
  expect((await init.json()).result).toMatchObject({
    protocolVersion: "2025-06-18",
    capabilities: { tools: {} },
    serverInfo: { name: "beacon" },
  });

  const initialized = await request.post("/api/mcp", {
    data: { jsonrpc: "2.0", method: "notifications/initialized" },
  });
  expect(initialized.status()).toBe(202);
  expect(await initialized.text()).toBe("");

  const listed = await request.post("/api/mcp", { data: rpc("tools/list") });
  const names = ((await listed.json()).result.tools as Array<{ name: string }>).map((t) => t.name);
  expect(names).toEqual(["search_firms", "get_firm_evidence", "list_rules"]);

  const search = await request.post("/api/mcp", {
    data: rpc("tools/call", { name: "search_firms", arguments: { limit: 500 } }),
  });
  const found = (await search.json()).result.structuredContent;
  // A limit past the cap is clamped.
  expect(found.firms).toHaveLength(25);

  const evidence = await request.post("/api/mcp", {
    data: rpc("tools/call", {
      name: "get_firm_evidence",
      arguments: { firmId: found.firms[0].firmId },
    }),
  });
  const result = (await evidence.json()).result;
  expect(result.isError).toBeUndefined();
  expect(result.structuredContent.axes.length).toBeGreaterThan(0);

  // The server only reads: GET is not offered and an unknown tool is a protocol error.
  expect((await request.get("/api/mcp")).status()).toBe(405);
  const unknown = await request.post("/api/mcp", {
    data: rpc("tools/call", { name: "delete_firm", arguments: {} }),
  });
  expect((await unknown.json()).error.code).toBe(-32602);
});

test("the persona header decides whose view an MCP client gets", async ({ request }) => {
  // The seed restricts a few firms; only compliance can list them.
  const restricted = await request.get("/api/objects?type=RestrictedFirm", {
    headers: { "x-beacon-persona": "compliance" },
  });
  const { firmId } = (await restricted.json()).data[0] as { firmId: string };

  const evidence = async (persona?: string) => {
    const res = await request.post("/api/mcp", {
      headers: persona ? { "x-beacon-persona": persona } : {},
      data: rpc("tools/call", { name: "get_firm_evidence", arguments: { firmId } }),
    });
    expect(res.status()).toBe(200);
    return (await res.json()).result;
  };
  // With no header the caller is the analyst, who is told the firm does not exist.
  expect((await evidence()).isError).toBe(true);
  expect((await evidence("analyst")).content[0].text).toBe(`Firm ${firmId} not found`);
  expect((await evidence("deal_lead")).isError).toBe(true);
  expect((await evidence("compliance")).isError).toBeUndefined();
});

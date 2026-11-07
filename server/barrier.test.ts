/**
 * The information barrier, end to end against the real handlers and an in-memory Postgres: a
 * restricted firm must be absent from every way the server hands data out, for the analyst and the
 * deal lead, and present (with its reason) for compliance. Need-to-know replaces a walled
 * mandate's name with its codename everywhere. The access log is written, bounded and cleared.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as actions } from "../api/actions.js";
import { GET as functions } from "../api/functions.js";
import { POST as links } from "../api/links.js";
import { POST as mcp } from "../api/mcp.js";
import { GET as objects } from "../api/objects.js";
import { codenameFor } from "../shared/accessPolicy.js";
import { exportFileName, exportRows } from "../shared/exportRows.js";
import { moreLikeThis } from "../shared/lookalikes.js";
import type { AccuracySummary, HomeSummary, ShellCounts } from "../shared/summaries.js";
import { MAX_ACCESS_LOG, buildAccess, logAccess, resolveAccess } from "./access.js";
import { heuristicClusterer } from "./clustering/heuristic.js";
import type { Clusterer } from "./clustering/types.js";
import { type Db, overrideDb } from "./db/client.js";
import { insertObject, insertObjects } from "./db/repo.js";
import { HttpError } from "./errors.js";
import { resetFromSnapshot, saveSnapshot } from "./seed/snapshot.js";
import { STRONG_CF, createTestDb, run, seedFirm } from "./testing.js";

const SECRET = "firm-secret";
const SECRET_NAME = "Hush Partners";
const REASON = "Live mandate: firm advises a counterparty";
const WALLED = "m-walled";
const WALLED_TITLE = "Sell-side of Acme Wealth";
const AT = "2026-09-01T12:00:00.000Z";

const call = (path: string, persona?: string, init: RequestInit = {}) =>
  new Request(`http://localhost${path}`, {
    ...init,
    headers: { ...(persona ? { "x-beacon-persona": persona } : {}), ...init.headers },
  });
const post = (path: string, body: unknown, persona?: string) =>
  call(path, persona, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

type Wire = Record<string, unknown> & { $primaryKey: string };

async function list(type: string, persona?: string, query = ""): Promise<Wire[]> {
  const out: Wire[] = [];
  let token: string | null = null;
  do {
    const res = await objects(
      call(
        `/api/objects?type=${type}&pageSize=2${query}${token ? `&pageToken=${token}` : ""}`,
        persona,
      ),
    );
    expect(res.status, `${type} as ${persona}`).toBe(200);
    const page = (await res.json()) as { data: Wire[]; nextPageToken: string | null };
    out.push(...page.data);
    token = page.nextPageToken;
  } while (token !== null);
  return out;
}

const fn = async <T>(
  name: string,
  persona: string | undefined,
  params: object = {},
): Promise<T> => {
  const res = await functions(
    call(
      `/api/functions?name=${name}&params=${encodeURIComponent(JSON.stringify(params))}`,
      persona,
    ),
  );
  expect(res.status, `${name} as ${persona}`).toBe(200);
  return ((await res.json()) as { value: T }).value;
};

const fnStatus = async (
  name: string,
  persona: string | undefined,
  params: object,
): Promise<number> =>
  (
    await functions(
      call(
        `/api/functions?name=${name}&params=${encodeURIComponent(JSON.stringify(params))}`,
        persona,
      ),
    )
  ).status;

let db: Db;

async function buildWorld(): Promise<Db> {
  const d = await createTestDb();
  overrideDb(d);
  const profile = { ...STRONG_CF, sector: "Software", hqCountry: "United States" };
  await seedFirm(d, { firmId: "firm-ok-1", firmName: "Alpha Advisors", ...profile });
  await seedFirm(d, { firmId: "firm-ok-2", firmName: "Beta Advisors", ...profile });
  // The restricted firm is the closest match to firm-ok-1: only the wall keeps it out of lookalikes.
  await seedFirm(d, { firmId: SECRET, firmName: SECRET_NAME, ...profile });
  await insertObject(d, "RestrictedFirm", { firmId: SECRET, reason: REASON, addedAt: AT });

  for (const firmId of ["firm-ok-1", SECRET]) {
    await insertObjects(d, "ResearchFinding", [
      {
        findingId: `finding-${firmId}`,
        firmId,
        axis: "firmAge",
        value: "15",
        provider: "beacondb",
        findingStatus: "proposed",
        confidenceTier: "high",
        retrievedAt: AT,
      },
    ]);
    await insertObject(d, "QualificationScore", { scoreId: `score-${firmId}`, firmId, tier: "A" });
    await insertObject(d, "ReviewDecision", {
      decisionId: `decision-${firmId}`,
      firmId,
      decisionType: "reject",
      decidedAt: AT,
    });
    await insertObject(d, "DriftEvent", {
      driftEventId: `drift-${firmId}`,
      firmId,
      driftReason: "tier_moved",
      driftStatus: "open",
      detectedAt: AT,
    });
    await insertObject(d, "MarketSignal", { signalId: `signal-${firmId}`, firmId, kind: "hire" });
  }

  await insertObject(d, "Mandate", {
    mandateId: "m-open",
    title: "European mid-market advisers",
    intentStatement: "European mid-market advisers",
    codename: "Project Osprey",
    active: true,
    createdAt: AT,
  });
  await insertObject(d, "Mandate", {
    mandateId: WALLED,
    title: WALLED_TITLE,
    intentStatement: "Find advisers to sell Acme Wealth to a strategic buyer",
    codename: "Project Kestrel",
    active: true,
    createdAt: AT,
  });
  await insertObjects(d, "MandateAccess", [
    { accessId: "a1", mandateId: "m-open", persona: "analyst" },
    { accessId: "a2", mandateId: "m-open", persona: "deal_lead" },
    { accessId: "a3", mandateId: "m-open", persona: "compliance" },
    { accessId: "a4", mandateId: WALLED, persona: "deal_lead" },
    { accessId: "a5", mandateId: WALLED, persona: "compliance" },
  ]);
  await insertObject(d, "Search", {
    searchId: "s1",
    name: `${WALLED_TITLE} · 2026-09-01`,
    mandateId: WALLED,
    runAt: AT,
  });
  await insertObject(d, "SearchList", {
    searchId: "L1",
    name: `${WALLED_TITLE} — universe`,
    mandateId: WALLED,
  });
  await insertObjects(d, "SearchMembership", [
    { membershipId: "s1:ok", searchId: "s1", firmId: "firm-ok-1" },
    { membershipId: "s1:secret", searchId: "s1", firmId: SECRET },
  ]);
  await d.query(
    `INSERT INTO search_list_firm ("searchId", "firmId") VALUES ('L1', 'firm-ok-1'), ('L1', $1)`,
    [SECRET],
  );
  return d;
}

const NOT_ACME = (text: string): void => {
  expect(text).not.toContain("Acme");
};

describe("information barrier", () => {
  beforeAll(async () => {
    db = await buildWorld();
  });
  afterAll(async () => {
    await db.close();
  });

  it("restricted firm is hidden from every read path", async () => {
    for (const persona of ["analyst", "deal_lead", undefined, "not-a-persona"]) {
      const as = persona ?? "(no header)";
      const idsOf = (rows: Wire[]) => rows.map((r) => r.$primaryKey);

      // Object lists, paged (a hidden row must not cost a page its size or break a cursor).
      const firms = await list("Firm", persona);
      expect(idsOf(firms), as).toEqual(["firm-ok-1", "firm-ok-2"]);
      expect(JSON.stringify(firms), as).not.toContain(SECRET_NAME);
      for (const type of [
        "ResearchFinding",
        "QualificationScore",
        "ReviewDecision",
        "DriftEvent",
        "MarketSignal",
        "SearchMembership",
      ]) {
        const rows = await list(type, persona);
        expect(rows.length, `${type} as ${as}`).toBeGreaterThan(0);
        expect(
          rows.filter((r) => r.firmId === SECRET),
          `${type} as ${as}`,
        ).toEqual([]);
      }

      // A lookup by key, as a get and as the one-row list the screens make.
      const get = await objects(call(`/api/objects?type=Firm&id=${SECRET}`, persona));
      expect(get.status, as).toBe(404);
      const unknown = await objects(call(`/api/objects?type=Firm&id=firm-nope`, persona));
      expect(unknown.status, as).toBe(404);
      expect(((await get.json()) as { error: string }).error.replace(SECRET, "X"), as).toBe(
        ((await unknown.json()) as { error: string }).error.replace("firm-nope", "X"),
      );
      const where = encodeURIComponent(JSON.stringify({ firmId: { $eq: SECRET } }));
      const pinned = (await (
        await objects(call(`/api/objects?type=Firm&where=${where}&pageSize=1`, persona))
      ).json()) as { data: unknown[] };
      expect(pinned.data, as).toEqual([]);
      expect((await objects(call(`/api/objects?type=Firm&id=firm-ok-1`, persona))).status).toBe(
        200,
      );

      // The policy and the log are not for anyone but compliance.
      for (const type of ["RestrictedFirm", "AccessLogEntry", "MandateAccess"]) {
        expect((await objects(call(`/api/objects?type=${type}`, persona))).status, type).toBe(403);
      }

      // Links: a search's firms and a universe list's firms.
      for (const [type, link, pk] of [
        ["Search", "firms", "s1"],
        ["SearchList", "firms", "L1"],
      ]) {
        const res = await links(post("/api/links", { type, link, pks: [pk] }, persona));
        const linked = ((await res.json()) as { data: Record<string, Wire[]> }).data[pk];
        expect(
          linked.map((f) => f.$primaryKey),
          `${type} as ${as}`,
        ).toEqual(["firm-ok-1"]);
      }

      // Query functions, aggregates included.
      const home = await fn<HomeSummary>("homeSummary", persona);
      expect(
        Object.values(home.funnel).reduce((a, b) => a + b, 0),
        as,
      ).toBe(2);
      expect(JSON.stringify(home), as).not.toContain(SECRET);
      expect(JSON.stringify(home), as).not.toContain(SECRET_NAME);
      expect(home.needsYouCounts.review, as).toBe(1);
      const counts = await fn<ShellCounts>("shellCounts", persona);
      expect(counts, as).toMatchObject({ open: 2, review: 1 });
      const accuracy = await fn<AccuracySummary>("accuracySummary", persona);
      expect(accuracy.overall.total, as).toBe(1);
      expect(await fnStatus("firmObservations", persona, { firmId: SECRET })).toBe(404);
      expect(
        await fnStatus("sourceDocument", persona, {
          firmId: SECRET,
          provider: "dealdb",
        }),
      ).toBe(404);
      expect(await fnStatus("firmObservations", persona, { firmId: "firm-ok-1" })).toBe(200);
      // Operations metrics describe the app, not firms: the function runs and names none.
      expect(JSON.stringify(await fn("operationsSummary", persona))).not.toContain(SECRET);

      // Palette-shaped data: the firm list the ⌘K palette is built from (by name, every page).
      const palette = await list(
        "Firm",
        persona,
        `&orderBy=${encodeURIComponent('{"firmName":"asc"}')}`,
      );
      expect(
        palette.map((f) => f.firmName),
        as,
      ).toEqual(["Alpha Advisors", "Beta Advisors"]);

      // Exports are built in the browser from these lists: nothing of the firm can reach them.
      const findings = await list("ResearchFinding", persona);
      const { rows, citations } = exportRows(firms as never, findings as never);
      expect(
        rows.map((r) => r.firmId),
        as,
      ).toEqual(["firm-ok-1", "firm-ok-2"]);
      expect(citations, as).toHaveLength(2);
      expect(JSON.stringify(rows), as).not.toContain(SECRET_NAME);

      // Lookalikes: the restricted firm is the closest match to firm-ok-1 and still never comes back.
      expect(
        moreLikeThis("firm-ok-1", firms as never).map((l) => l.firmId),
        as,
      ).toEqual(["firm-ok-2"]);
      expect(moreLikeThis(SECRET, firms as never), as).toEqual([]);

      // The tear sheet loads its firm by key and builds only from what comes back: nothing.
      const sheetFirm = (await (
        await objects(call(`/api/objects?type=Firm&where=${where}&pageSize=1`, persona))
      ).json()) as { data: unknown[] };
      expect(sheetFirm.data, as).toHaveLength(0);
    }
  });

  it("shows the restricted firm, with its reason, to compliance", async () => {
    const firms = await list("Firm", "compliance");
    expect(firms.map((f) => f.$primaryKey)).toEqual(["firm-ok-1", "firm-ok-2", SECRET]);
    expect((await objects(call(`/api/objects?type=Firm&id=${SECRET}`, "compliance"))).status).toBe(
      200,
    );

    const restricted = await list("RestrictedFirm", "compliance");
    expect(restricted).toHaveLength(1);
    expect(restricted[0]).toMatchObject({ firmId: SECRET, reason: REASON });

    const home = await fn<HomeSummary>("homeSummary", "compliance");
    expect(Object.values(home.funnel).reduce((a, b) => a + b, 0)).toBe(3);
    expect(await fn<ShellCounts>("shellCounts", "compliance")).toMatchObject({
      open: 3,
      review: 2,
    });
    expect((await fn<AccuracySummary>("accuracySummary", "compliance")).overall.total).toBe(2);
    expect(await fnStatus("firmObservations", "compliance", { firmId: SECRET })).toBe(200);
    expect(
      await fnStatus("sourceDocument", "compliance", { firmId: SECRET, provider: "dealdb" }),
    ).toBe(200);

    const linked = (await (
      await links(post("/api/links", { type: "Search", link: "firms", pks: ["s1"] }, "compliance"))
    ).json()) as { data: Record<string, Wire[]> };
    expect(linked.data.s1.map((f) => f.$primaryKey)).toEqual(["firm-ok-1", SECRET]);

    const { rows } = exportRows(
      firms as never,
      (await list("ResearchFinding", "compliance")) as never,
    );
    expect(rows.map((r) => r.firmName)).toContain(SECRET_NAME);
    expect(moreLikeThis("firm-ok-1", firms as never).map((l) => l.firmId)).toContain(SECRET);

    expect((await list("AccessLogEntry", "compliance")).length).toBeGreaterThanOrEqual(0);
    expect(await list("MandateAccess", "compliance")).toHaveLength(5);
  });

  it("refuses an action on a restricted firm, or on anything of one, as if it did not exist", async () => {
    const analyst = async (body: unknown) => actions(post("/api/actions", body, "analyst"));
    const hidden = await analyst({ action: "qualifyFirm", params: { firm: SECRET } });
    const unknown = await analyst({ action: "qualifyFirm", params: { firm: "firm-nope" } });
    expect(hidden.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(((await hidden.json()) as { error: string }).error).toBe(`Firm ${SECRET} not found`);
    // A finding and a drift event of the firm are as absent as the firm.
    expect(
      (await analyst({ action: "verifyFinding", params: { finding: `finding-${SECRET}` } })).status,
    ).toBe(404);
    expect(
      (
        await analyst({
          action: "acknowledgeDrift",
          params: { driftEvent: `drift-${SECRET}`, note: null },
        })
      ).status,
    ).toBe(404);
    // Nothing happened to it, and the deal lead is held to the same wall.
    const deal = await actions(
      post("/api/actions", { action: "qualifyFirm", params: { firm: SECRET } }, "deal_lead"),
    );
    expect(deal.status).toBe(404);
    const [row] = await db.query<{ lifecycleState: string }>(
      `SELECT "lifecycleState" FROM firm WHERE "firmId" = $1`,
      [SECRET],
    );
    expect(row.lifecycleState).toBe("Screening");
    // An ordinary firm is untouched by all of this.
    expect((await analyst({ action: "qualifyFirm", params: { firm: "firm-ok-2" } })).status).toBe(
      200,
    );
  });

  it("keeps a restricted firm out of a search an analyst runs", async () => {
    const run = async (persona: string) => {
      const res = await actions(
        post(
          "/api/actions",
          { action: "runSearch", params: { mandate: "m-open", breadth: "exhaustive" } },
          persona,
        ),
      );
      expect(res.status, persona).toBe(200);
      const { created } = (await res.json()) as { created: string[] };
      const rows = await db.query<{ firmId: string }>(
        `SELECT "firmId" FROM search_membership WHERE "searchId" = $1`,
        [created[0]],
      );
      return rows.map((r) => r.firmId);
    };
    expect(await run("analyst")).not.toContain(SECRET);
    expect(await run("compliance")).toContain(SECRET);
  });

  it("names a walled mandate by its codename wherever it appears", async () => {
    const mandates = async (persona: string) => list("Mandate", persona);
    for (const persona of ["analyst"]) {
      const rows = await mandates(persona);
      const walled = rows.find((m) => m.$primaryKey === WALLED)!;
      expect(walled.title).toBe("Project Kestrel");
      expect(walled.intentStatement).toBeUndefined();
      // The mandate itself, and the others, stay.
      expect(rows.map((m) => m.$primaryKey)).toEqual(["m-open", WALLED]);
      expect(rows.find((m) => m.$primaryKey === "m-open")!.title).toBe(
        "European mid-market advisers",
      );
      expect(JSON.stringify(rows)).not.toContain("Acme");

      // By key, as a get and as a pinned list.
      const got = (await (
        await objects(call(`/api/objects?type=Mandate&id=${WALLED}`, persona))
      ).json()) as {
        data: Wire;
      };
      expect(got.data.title).toBe("Project Kestrel");
      NOT_ACME(JSON.stringify(got));

      // The searches and lists named after it.
      const searches = await list("Search", persona);
      expect(searches[0].name).toBe("Project Kestrel · 2026-09-01");
      expect((await list("SearchList", persona))[0].name).toBe("Project Kestrel — universe");

      // Home, the Pipeline's and the exports' mandate name.
      const home = await fn<HomeSummary>("homeSummary", persona);
      const card = home.mandates.find((m) => m.mandateId === WALLED)!;
      expect(card.title).toBe("Project Kestrel");
      expect(card.intentStatement).toBeUndefined();
      NOT_ACME(JSON.stringify(home));
      const named = (walled.intentStatement as string | undefined) ?? (walled.title as string);
      expect(exportFileName(named, "xlsx", new Date(2026, 8, 1))).toBe(
        "beacon-project-kestrel-2026-09-01.xlsx",
      );

      // Its name cannot be probed by filtering or sorting on it, or on the names built from it.
      const probe = encodeURIComponent(JSON.stringify({ title: { $eq: WALLED_TITLE } }));
      expect(
        (await objects(call(`/api/objects?type=Mandate&where=${probe}`, persona))).status,
      ).toBe(400);
      const sortName = encodeURIComponent(JSON.stringify({ name: "asc" }));
      for (const [type, title] of [
        ["Search", `${WALLED_TITLE} · 2026-09-01`],
        ["SearchList", `${WALLED_TITLE} — universe`],
      ]) {
        const byName = encodeURIComponent(JSON.stringify({ name: { $eq: title } }));
        expect(
          (await objects(call(`/api/objects?type=${type}&where=${byName}`, persona))).status,
          `${type} where name`,
        ).toBe(400);
        expect(
          (await objects(call(`/api/objects?type=${type}&orderBy=${sortName}`, persona))).status,
          `${type} orderBy name`,
        ).toBe(400);
      }
    }
    for (const persona of ["deal_lead", "compliance"]) {
      // Holding need-to-know, a name filter is an ordinary query.
      const byName = encodeURIComponent(
        JSON.stringify({ name: { $eq: `${WALLED_TITLE} — universe` } }),
      );
      expect(
        (await objects(call(`/api/objects?type=SearchList&where=${byName}`, persona))).status,
        persona,
      ).toBe(200);
      const rows = await mandates(persona);
      const walled = rows.find((m) => m.$primaryKey === WALLED)!;
      expect(walled.title, persona).toBe(WALLED_TITLE);
      expect(walled.intentStatement, persona).toBe(
        "Find advisers to sell Acme Wealth to a strategic buyer",
      );
      expect((await list("Search", persona))[0].name, persona).toBe(`${WALLED_TITLE} · 2026-09-01`);
      expect(
        (await fn<HomeSummary>("homeSummary", persona)).mandates.find(
          (m) => m.mandateId === WALLED,
        )!.title,
        persona,
      ).toBe(WALLED_TITLE);
    }
  });

  it("hides the restricted firm from every MCP tool, and names a walled mandate by its codename", async () => {
    await insertObjects(db, "ProposedRule", [
      {
        // Rests on a decision about the restricted firm and one about an ordinary firm.
        proposedRuleId: "rule-mixed",
        predicateAxis: "employees",
        ruleOperator: "<",
        ruleThreshold: "10",
        ruleModel: "CF",
        rationaleClusterSummary: "Too small to cover",
        supportingFirmCount: 2,
        supportingDecisionIds: JSON.stringify([`decision-firm-ok-1`, `decision-${SECRET}`]),
        projectedScreenCount: 3,
        ruleStatus: "pending",
        proposedAt: AT,
        mandateScope: "All mandates",
      },
      {
        // Scoped to the walled mandate, by its real title.
        proposedRuleId: "rule-walled",
        predicateAxis: "firm_age",
        ruleOperator: "<",
        ruleThreshold: "3",
        ruleModel: "CF",
        rationaleClusterSummary: `Too young for ${WALLED_TITLE}`,
        supportingFirmCount: 4,
        supportingDecisionIds: "[]",
        projectedScreenCount: 1,
        ruleStatus: "pending",
        proposedAt: "2026-09-02T12:00:00.000Z",
        mandateScope: WALLED_TITLE,
      },
    ]);

    interface ToolReply {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
      structuredContent: {
        firmName: string;
        totalMatches: number;
        firms: Array<{ firmId: string }>;
        rules: Array<{ ruleId: string }>;
      };
    }
    const callTool = async (
      name: string,
      args: object,
      persona: string | undefined,
    ): Promise<ToolReply> => {
      const res = await mcp(
        post(
          "/api/mcp",
          { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
          persona,
        ),
      );
      expect(res.status, `${name} as ${persona}`).toBe(200);
      return ((await res.json()) as { result: ToolReply }).result;
    };

    for (const persona of ["analyst", "deal_lead", undefined, "not-a-persona"]) {
      const as = persona ?? "(no header)";

      // search_firms: not in a plain listing, and not found by its own name.
      const all = await callTool("search_firms", { limit: 25 }, persona);
      expect(
        all.structuredContent.firms.map((f: { firmId: string }) => f.firmId).sort(),
        as,
      ).toEqual(["firm-ok-1", "firm-ok-2"]);
      expect(all.structuredContent.totalMatches, as).toBe(2);
      const byName = await callTool("search_firms", { query: SECRET_NAME }, persona);
      expect(byName.structuredContent.totalMatches, as).toBe(0);
      expect(JSON.stringify([all, byName]), as).not.toContain(SECRET);
      expect(JSON.stringify([all, byName]), as).not.toContain(SECRET_NAME);

      // get_firm_evidence: the same "not found" as a firm that does not exist.
      const hidden = await callTool("get_firm_evidence", { firmId: SECRET }, persona);
      const missing = await callTool("get_firm_evidence", { firmId: "firm-nope" }, persona);
      expect(hidden.isError, as).toBe(true);
      expect(hidden.content[0].text.replace(SECRET, "X"), as).toBe(
        missing.content[0].text.replace("firm-nope", "X"),
      );
      expect(JSON.stringify(hidden), as).not.toContain(SECRET_NAME);
      const ok = await callTool("get_firm_evidence", { firmId: "firm-ok-1" }, persona);
      expect(ok.isError, as).toBeUndefined();
      expect(ok.structuredContent.firmName, as).toBe("Alpha Advisors");

      // list_rules: the restricted firm's decision is not counted, and the rationale resting on it
      // is withheld; a rule scoped to a walled mandate names its codename.
      const rules = await callTool("list_rules", {}, persona);
      const byId = new Map(rules.structuredContent.rules.map((r) => [r.ruleId, r] as const));
      expect(byId.get("rule-mixed"), as).toMatchObject({
        supportingFirmCount: 1,
        rationale: null,
        rationaleWithheld: true,
      });
      // The deal lead holds the walled mandate, so it reads the real title; the analyst does not.
      const title = persona === "deal_lead" ? WALLED_TITLE : "Project Kestrel";
      expect(byId.get("rule-walled"), as).toMatchObject({
        scope: title,
        rationale: `Too young for ${title}`,
      });
      if (persona !== "deal_lead") {
        expect(JSON.stringify(rules), as).not.toContain("Acme");
        expect(JSON.stringify(rules), as).not.toContain(WALLED_TITLE);
      }
    }

    // Compliance sees the firm, its evidence and the whole rule; the deal lead holds the mandate.
    const complianceSearch = await callTool("search_firms", { query: SECRET_NAME }, "compliance");
    expect(
      complianceSearch.structuredContent.firms.map((f: { firmId: string }) => f.firmId),
    ).toEqual([SECRET]);
    const evidence = await callTool("get_firm_evidence", { firmId: SECRET }, "compliance");
    expect(evidence.isError).toBeUndefined();
    expect(evidence.structuredContent.firmName).toBe(SECRET_NAME);
    const complianceRules = await callTool("list_rules", {}, "compliance");
    const mixed = complianceRules.structuredContent.rules.find(
      (r: { ruleId: string }) => r.ruleId === "rule-mixed",
    );
    expect(mixed).toMatchObject({
      supportingFirmCount: 2,
      rationale: "Too small to cover",
      rationaleWithheld: false,
    });
    // Opening a firm through MCP is viewing it: the access log says who.
    const viewed = await db.query<{ persona: string }>(
      `SELECT "persona" FROM access_log_entry WHERE "objectType" = 'Firm' AND "objectId" = $1`,
      [SECRET],
    );
    expect(viewed.map((r) => r.persona)).toEqual(["compliance"]);
    await db.query(`DELETE FROM proposed_rule WHERE "proposedRuleId" LIKE 'rule-%'`);
  });

  it("redacts a rule's rationale and decision ids on the objects route as the MCP does", async () => {
    await insertObjects(db, "ProposedRule", [
      {
        proposedRuleId: "rule-mixed",
        predicateAxis: "employees",
        ruleOperator: "<",
        ruleThreshold: "10",
        ruleModel: "CF",
        rationaleClusterSummary: "Too small to cover",
        supportingFirmCount: 2,
        supportingDecisionIds: JSON.stringify(["decision-firm-ok-1", `decision-${SECRET}`]),
        projectedScreenCount: 3,
        ruleStatus: "pending",
        proposedAt: AT,
        mandateScope: "All mandates",
      },
      {
        proposedRuleId: "rule-walled",
        predicateAxis: "firm_age",
        ruleOperator: "<",
        ruleThreshold: "3",
        ruleModel: "CF",
        rationaleClusterSummary: `Too young for ${WALLED_TITLE}`,
        supportingFirmCount: 4,
        supportingDecisionIds: "[]",
        projectedScreenCount: 1,
        ruleStatus: "pending",
        proposedAt: "2026-09-02T12:00:00.000Z",
        mandateScope: WALLED_TITLE,
      },
    ]);
    const mcpRules = async (persona: string | undefined) => {
      const res = await mcp(
        post(
          "/api/mcp",
          {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "list_rules", arguments: {} },
          },
          persona,
        ),
      );
      const reply = (await res.json()) as {
        result: {
          structuredContent: {
            rules: Array<{
              ruleId: string;
              rationale: string | null;
              rationaleWithheld: boolean;
              supportingFirmCount: number;
              scope: string | null;
            }>;
          };
        };
      };
      return new Map(reply.result.structuredContent.rules.map((r) => [r.ruleId, r] as const));
    };

    for (const persona of ["analyst", "deal_lead", undefined, "not-a-persona"]) {
      const as = persona ?? "(no header)";
      const rules = new Map((await list("ProposedRule", persona)).map((r) => [r.$primaryKey, r]));
      const viaMcp = await mcpRules(persona);
      const mixed = rules.get("rule-mixed")!;

      // The decision on the restricted firm: out of the count, the id list and the rationale.
      expect(mixed.supportingFirmCount, as).toBe(1);
      expect(JSON.parse(mixed.supportingDecisionIds as string), as).toEqual(["decision-firm-ok-1"]);
      expect(mixed.rationaleClusterSummary, as).toBeUndefined();
      expect(JSON.stringify(mixed), as).not.toContain(SECRET);
      expect(JSON.stringify(mixed), as).not.toContain("Too small to cover");

      // The same facts as the MCP tool gives for the same persona.
      expect(mixed.supportingFirmCount, as).toBe(viaMcp.get("rule-mixed")!.supportingFirmCount);
      expect(viaMcp.get("rule-mixed")!.rationaleWithheld, as).toBe(true);
      const walled = rules.get("rule-walled")!;
      expect(walled.mandateScope, as).toBe(viaMcp.get("rule-walled")!.scope);
      expect(walled.rationaleClusterSummary, as).toBe(viaMcp.get("rule-walled")!.rationale);
      if (persona !== "deal_lead") {
        expect(JSON.stringify([...rules.values()]), as).not.toContain("Acme");
      }

      // A lookup by key is redacted the same way.
      const one = await objects(call("/api/objects?type=ProposedRule&id=rule-mixed", persona));
      const lookup = ((await one.json()) as { data: Wire }).data;
      expect(lookup.rationaleClusterSummary, as).toBeUndefined();
      expect(lookup.supportingFirmCount, as).toBe(1);
    }

    // Compliance sees the whole rule.
    const whole = (await list("ProposedRule", "compliance")).find(
      (r) => r.$primaryKey === "rule-mixed",
    )!;
    expect(whole).toMatchObject({
      supportingFirmCount: 2,
      rationaleClusterSummary: "Too small to cover",
    });
    expect(JSON.parse(whole.supportingDecisionIds as string)).toEqual([
      "decision-firm-ok-1",
      `decision-${SECRET}`,
    ]);
    await db.query(`DELETE FROM proposed_rule WHERE "proposedRuleId" LIKE 'rule-%'`);
  });

  it("gives a mandate nobody has been granted no codename, and a new one its own", async () => {
    await insertObject(db, "Mandate", {
      mandateId: "m-fresh",
      title: "A fresh mandate",
      active: true,
    });
    const fresh = (await list("Mandate", "analyst")).find((m) => m.$primaryKey === "m-fresh")!;
    expect(fresh.title).toBe("A fresh mandate");
    await db.query(`DELETE FROM mandate WHERE "mandateId" = 'm-fresh'`);
  });
});

describe("a new mandate's codename", () => {
  it("is never one another mandate already holds", async () => {
    const d = await createTestDb();
    const id = "mandate-fixed";
    await insertObject(d, "Mandate", {
      mandateId: "m-taken",
      title: "Taken",
      codename: codenameFor(id),
    });
    const made = await run(
      d,
      "runMandateSearch",
      { title: "Fresh", archetype: "CF" },
      { newId: (p) => (p === "mandate" ? id : `${p}-x`) },
    );
    expect(made.created![0]).toBe(id);
    const [row] = await d.query<{ codename: string }>(
      `SELECT "codename" FROM mandate WHERE "mandateId" = $1`,
      [id],
    );
    expect(row.codename).not.toBe(codenameFor(id));
    expect(row.codename).toMatch(/^Project [A-Z][a-z]+$/);
    await d.close();
  });
});

describe("resolveAccess", () => {
  it("reads the persona from the header and the policy from one query", async () => {
    const calls: string[] = [];
    const q = {
      query: async (sql: string) => {
        calls.push(sql);
        return [
          { k: "r", a: "firm-secret", b: "Conflict" },
          { k: "g", a: "m1", b: "deal_lead" },
          { k: "m", a: "m1", b: "Project Kestrel" },
        ];
      },
    };
    const analyst = await resolveAccess(call("/api/objects", "analyst"), q as never);
    expect(calls).toHaveLength(1);
    expect(analyst.persona).toBe("analyst");
    expect([...analyst.restrictedFirmIds]).toEqual(["firm-secret"]);
    expect(analyst.hiddenFirmIds).toEqual(["firm-secret"]);
    expect(analyst.mandateGrants).toEqual([{ mandateId: "m1", persona: "deal_lead" }]);
    expect(analyst.mandateCodenames.get("m1")).toBe("Project Kestrel");
    expect(analyst.restrictedReasons.get("firm-secret")).toBe("Conflict");

    const compliance = await resolveAccess(call("/api/objects", "compliance"), q as never);
    expect(compliance.hiddenFirmIds).toEqual([]);
    expect([...compliance.restrictedFirmIds]).toEqual(["firm-secret"]);
    expect((await resolveAccess(call("/api/objects"), q as never)).persona).toBe("analyst");
  });

  it("builds an empty wall from no rows", () => {
    const access = buildAccess("analyst", []);
    expect(access.hiddenFirmIds).toEqual([]);
    expect(access.mandateGrants).toEqual([]);
  });
});

describe("access log", () => {
  let logDb: Db;
  beforeAll(async () => {
    logDb = await buildWorld();
    await logDb.query(`DELETE FROM access_log_entry`);
  });
  afterAll(async () => {
    await logDb.close();
  });

  const entries = () =>
    logDb.query<{ persona: string; objectType: string; objectId: string }>(
      `SELECT "persona", "objectType", "objectId" FROM access_log_entry ORDER BY "viewedAt", "entryId"`,
    );

  it("records a firm opened in detail and a mandate opened, once per persona and object", async () => {
    // Listing is browsing, not opening.
    await list("Firm", "analyst");
    await list("Mandate", "analyst");
    expect(await entries()).toEqual([]);

    const where = (key: string, id: string) =>
      encodeURIComponent(JSON.stringify({ [key]: { $eq: id } }));
    await objects(
      call(`/api/objects?type=Firm&where=${where("firmId", "firm-ok-1")}&pageSize=1`, "analyst"),
    );
    await objects(
      call(`/api/objects?type=Firm&where=${where("firmId", "firm-ok-1")}&pageSize=1`, "analyst"),
    );
    await objects(call(`/api/objects?type=Firm&id=firm-ok-2`, "deal_lead"));
    await objects(
      call(`/api/objects?type=Mandate&where=${where("mandateId", "m-open")}&pageSize=1`, "analyst"),
    );
    await fn("firmObservations", "compliance", { firmId: SECRET });
    await fn("sourceDocument", "analyst", { firmId: "firm-ok-2", provider: "dealdb" });

    expect(await entries()).toEqual(
      expect.arrayContaining([
        { persona: "analyst", objectType: "Firm", objectId: "firm-ok-1" },
        { persona: "deal_lead", objectType: "Firm", objectId: "firm-ok-2" },
        { persona: "analyst", objectType: "Mandate", objectId: "m-open" },
        { persona: "compliance", objectType: "Firm", objectId: SECRET },
        { persona: "analyst", objectType: "Firm", objectId: "firm-ok-2" },
      ]),
    );
    // The repeat within the window was one view.
    expect((await entries()).filter((e) => e.objectId === "firm-ok-1")).toHaveLength(1);
  });

  it("does not log an attempt on a firm the persona cannot see, and does not fail the read", async () => {
    const before = (await entries()).length;
    expect((await objects(call(`/api/objects?type=Firm&id=${SECRET}`, "analyst"))).status).toBe(
      404,
    );
    expect(await fnStatus("firmObservations", "analyst", { firmId: SECRET })).toBe(404);
    expect(await entries()).toHaveLength(before);
  });

  it("lets only compliance read the log", async () => {
    const log = await list("AccessLogEntry", "compliance");
    expect(log.length).toBeGreaterThan(0);
    expect(log[0]).toMatchObject({ persona: expect.any(String), objectType: expect.any(String) });
    expect((await objects(call(`/api/objects?type=AccessLogEntry`, "deal_lead"))).status).toBe(403);
  });

  it("keeps the newest 500 rows when it grows", async () => {
    await logDb.query(`DELETE FROM access_log_entry`);
    await logDb.query(
      `INSERT INTO access_log_entry ("entryId", "persona", "objectType", "objectId", "viewedAt")
       SELECT 'old-' || lpad(i::text, 4, '0'), 'analyst', 'Firm', 'f' || i, '2026-01-01T00:00:00Z'::timestamptz + (i || ' minutes')::interval
         FROM generate_series(1, ${MAX_ACCESS_LOG + 5}) i`,
    );
    await logAccess(
      logDb,
      { persona: "deal_lead" },
      "Firm",
      "firm-newest",
      new Date("2026-02-01T00:00:00Z"),
    );
    const [{ n }] = await logDb.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM access_log_entry`,
    );
    expect(n).toBe(MAX_ACCESS_LOG);
    const ids = await logDb.query<{ entryId: string; objectId: string }>(
      `SELECT * FROM access_log_entry`,
    );
    // The newest is kept; the oldest six are gone.
    expect(ids.some((r) => r.objectId === "firm-newest")).toBe(true);
    expect(ids.some((r) => r.entryId === "old-0001")).toBe(false);
    expect(ids.some((r) => r.entryId === "old-0006")).toBe(false);
    expect(ids.some((r) => r.entryId === "old-0007")).toBe(true);
  });

  it("never fails the read it belongs to", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = {
      query: () => Promise.reject(new HttpError("the log table is gone", 500)),
    };
    await expect(logAccess(broken, { persona: "analyst" }, "Firm", "f")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("is cleared by a reset, while the restrictions and grants are restored", async () => {
    await logAccess(logDb, { persona: "analyst" }, "Firm", "firm-ok-1");
    expect((await entries()).length).toBeGreaterThan(0);
    await saveSnapshot(logDb, new Date());
    await logDb.query(`DELETE FROM restricted_firm`);
    await logDb.query(`DELETE FROM mandate_access`);
    await resetFromSnapshot(logDb);
    expect(await entries()).toEqual([]);
    const restricted = await logDb.query<{ firmId: string; reason: string }>(
      `SELECT "firmId", "reason" FROM restricted_firm`,
    );
    expect(restricted).toEqual([{ firmId: SECRET, reason: REASON }]);
    expect((await logDb.query(`SELECT 1 FROM mandate_access`)).length).toBe(5);
  });
});

describe("clusterRejections under the wall", () => {
  it("ignores the decisions on firms hidden from the acting persona", async () => {
    const d = await createTestDb();
    const small = async (id: string) => {
      await seedFirm(d, { firmId: id, employees: 4 });
      await run(d, "rejectFirm", { firm: id, rejectionRationale: `Too small: ${id} has 4 staff.` });
    };
    for (const id of ["v1", "v2", "v3", SECRET]) {
      await small(id);
    }
    const asked: string[][] = [];
    const clusterer: Clusterer = (rows) => {
      asked.push(rows.map((r) => r.firmId));
      return heuristicClusterer(rows);
    };
    const analyst = buildAccess("analyst", [{ k: "r", a: SECRET, b: "Conflict" }]);
    const compliance = buildAccess("compliance", [{ k: "r", a: SECRET, b: "Conflict" }]);

    // Three visible firms are fewer than a pattern needs: no rule, and the restricted firm never reached the clusterer.
    const refused = await run(d, "clusterRejections", {}, { clusterer, access: analyst });
    expect(refused.created).toEqual([]);
    expect(asked[0].sort()).toEqual(["v1", "v2", "v3"]);
    expect(await d.query(`SELECT 1 FROM proposed_rule`)).toEqual([]);

    // Compliance sees all four: the rule is proposed and cites the restricted firm's decision.
    const proposed = await run(d, "clusterRejections", {}, { clusterer, access: compliance });
    expect(proposed.created).toHaveLength(1);
    expect(asked[1].sort()).toEqual([SECRET, "v1", "v2", "v3"]);
    const [rule] = await d.query<{ supportingFirmCount: number }>(`SELECT * FROM proposed_rule`);
    expect(rule.supportingFirmCount).toBe(4);
    await d.close();
  });
});

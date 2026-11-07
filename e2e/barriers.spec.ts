import { expect, test } from "@playwright/test";
import { ROUTES, openRoute } from "./routes";

const route = (path: string) => {
  const found = ROUTES.find((r) => r.path === path);
  if (found === undefined) {
    throw new Error(`no route ${path}`);
  }
  return found;
};

const WALLED_TITLE = /Confidential carve-out: regional wealth manager/;
const CODENAME = /Project Kestrel/;

test("switching persona turns a walled mandate into its codename", async ({ page }) => {
  // The analyst is the default: the mandate it holds no grant on shows only its codename.
  await openRoute(page, route("/mandate"));
  await expect(page.getByRole("region", { name: CODENAME })).toBeVisible();
  await expect(page.getByText(WALLED_TITLE)).toHaveCount(0);

  // The deal-team lead holds every mandate: the real title appears, the codename goes.
  await page.getByLabel("Viewing as").selectOption("deal_lead");
  await expect(page.getByRole("region", { name: WALLED_TITLE })).toBeVisible();
  await expect(page.getByRole("region", { name: CODENAME })).toHaveCount(0);

  // The choice is kept for the next visit, and switching back hides the title again.
  await page.reload();
  await expect(page.getByLabel("Viewing as")).toHaveValue("deal_lead");
  await expect(page.getByRole("region", { name: WALLED_TITLE })).toBeVisible();
  await page.getByLabel("Viewing as").selectOption("analyst");
  await expect(page.getByRole("region", { name: CODENAME })).toBeVisible();
  await expect(page.getByText(WALLED_TITLE)).toHaveCount(0);
});

test("the persona is sent on every API call and the demo says it is not a login", async ({
  page,
}) => {
  const personas = new Set<string>();
  page.on("request", (req) => {
    if (new URL(req.url()).pathname.startsWith("/api/")) {
      personas.add(req.headers()["x-beacon-persona"] ?? "(none)");
    }
  });
  await openRoute(page, route("/"));
  await expect(page.getByText("Anyone can switch. This is not a login.")).toBeVisible();
  await page.getByLabel("Viewing as").selectOption("compliance");
  await page.waitForLoadState("networkidle");
  expect([...personas].sort()).toEqual(["analyst", "compliance"]);
});

test("compliance opens the restricted list and the access log", async ({ page }) => {
  await openRoute(page, route("/"));
  // Nobody but compliance has the link.
  await expect(page.getByRole("link", { name: "Compliance" })).toHaveCount(0);
  await page.getByLabel("Viewing as").selectOption("compliance");
  await page.getByRole("link", { name: "Compliance" }).click();

  await expect(page).toHaveURL(/\/compliance$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Information barriers");
  const restricted = page.getByRole("region", { name: "Restricted firms" });
  await expect(restricted.getByRole("row")).toHaveCount(4); // header + three firms
  await expect(restricted.getByText("Live mandate: firm advises a counterparty")).toBeVisible();
  await expect(page.getByRole("region", { name: "Access log" })).toBeVisible();
  await expect(page.getByText("Demo", { exact: true }).first()).toBeVisible();

  // A restricted firm opens for compliance, and the view is logged. The lookup that opens the
  // firm must finish first, so the view is on the log when the page reads it.
  const opened = page.waitForResponse(
    (res) => res.url().includes("type=Firm") && res.url().includes("firmId") && res.ok(),
  );
  await restricted.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/desk\?firmId=/);
  await opened;
  // The Desk loads on demand: wait for it to show, so coming back opens Compliance afresh.
  await expect(page.getByRole("link", { name: "Tear sheet" })).toBeVisible();
  await page.getByRole("link", { name: "Compliance" }).click();
  const log = page.getByRole("region", { name: "Access log" });
  await expect(log.getByRole("row", { name: /Compliance.*Firm/ }).first()).toBeVisible();

  // On a phone the tables stay inside the page.
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
});

test("any other persona gets an empty state at /compliance", async ({ page }) => {
  await openRoute(page, route("/compliance"));
  await expect(page.getByText("Compliance only")).toBeVisible();
  await expect(page.getByRole("region", { name: "Restricted firms" })).toHaveCount(0);

  // The server refuses the data as well, whatever the page does.
  const refused = await page.request.get("/api/objects?type=RestrictedFirm");
  expect(refused.status()).toBe(403);
  const allowed = await page.request.get("/api/objects?type=RestrictedFirm", {
    headers: { "x-beacon-persona": "compliance" },
  });
  expect(allowed.status()).toBe(200);
  expect(((await allowed.json()) as { data: unknown[] }).data).toHaveLength(3);
});

test("a restricted firm is missing for the analyst and present for compliance", async ({
  page,
}) => {
  const restricted = (await (
    await page.request.get("/api/objects?type=RestrictedFirm", {
      headers: { "x-beacon-persona": "compliance" },
    })
  ).json()) as { data: { firmId: string }[] };
  const id = restricted.data[0].firmId;
  const asAnalyst = await page.request.get(`/api/objects?type=Firm&id=${encodeURIComponent(id)}`);
  expect(asAnalyst.status()).toBe(404);
  const asCompliance = await page.request.get(
    `/api/objects?type=Firm&id=${encodeURIComponent(id)}`,
    {
      headers: { "x-beacon-persona": "compliance" },
    },
  );
  expect(asCompliance.status()).toBe(200);
  // The tear sheet of a firm that does not exist for the analyst is the not-found page.
  await page.goto(`/firm/${encodeURIComponent(id)}/tear-sheet`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Firm not found");
});

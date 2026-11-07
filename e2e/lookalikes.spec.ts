import { type Page, expect, test } from "@playwright/test";
import { ROUTES, openRoute } from "./routes";

const desk = ROUTES.find((r) => r.path === "/desk")!;
const pipeline = ROUTES.find((r) => r.path === "/pipeline")!;
const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

const moreLikeThis = (page: Page) => page.getByRole("region", { name: "More like this" });
const approvedPanel = (page: Page) =>
  page.getByRole("region", { name: "Lookalikes of approved targets" });
const REASON =
  /^(Same (sub-sector|coverage model|model|HQ country|revenue band|ownership|succession risk)|Deal (size|velocity) within 10%): .+/;

async function showcaseFirmId(page: Page): Promise<string> {
  await openRoute(page, desk);
  await expect(page).toHaveURL(/\/desk\?firmId=/);
  return new URL(page.url()).searchParams.get("firmId")!;
}

test("more like this lists firms with reasons", async ({ page }) => {
  const id = await showcaseFirmId(page);

  const panel = moreLikeThis(page);
  await expect(panel).toBeVisible();
  const items = panel.getByRole("list", { name: "Firms like this one" }).locator("> li");
  await expect(items.first()).toBeVisible();
  const count = await items.count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThanOrEqual(5);

  // Every item links to a Desk, shows its tier and score, and gives at least one real reason.
  for (let i = 0; i < count; i += 1) {
    const item = items.nth(i);
    const href = await item.getByRole("link").first().getAttribute("href");
    expect(href).toMatch(/^\/desk\?firmId=.+/);
    expect(href).not.toContain(encodeURIComponent(id));
    await expect(item).toContainText(/Tier\s*[ABC]|Rejected/);
    await expect(item).toContainText(/\d+ of \d+ fields matched/);
    const reasons = await item.locator("ul > li").allInnerTexts();
    expect(reasons.length).toBeGreaterThan(0);
    for (const reason of reasons) {
      expect(reason).toMatch(REASON);
    }
  }

  // Following an item opens that firm's Desk.
  const first = items.first().getByRole("link").first();
  const name = (await first.innerText()).trim();
  await first.click();
  await expect(page).not.toHaveURL(new RegExp(`firmId=${encodeURIComponent(id)}$`));
  await expect(desk.heading(page).first()).toHaveText(name);
});

test("the tear sheet has the same panel, and keeps it off the printed page", async ({ page }) => {
  const id = await showcaseFirmId(page);
  await page.goto(`/firm/${encodeURIComponent(id)}/tear-sheet`);
  const panel = moreLikeThis(page);
  await expect(panel.getByRole("list", { name: "Firms like this one" })).toBeVisible();
  await expect(panel.getByRole("link").first()).toHaveAttribute("href", /^\/desk\?firmId=/);
  await expect(page.locator("h1")).toHaveCount(1);

  await page.emulateMedia({ media: "print" });
  await expect(panel).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await expect(panel).toBeVisible();
});

test("the pipeline finds lookalikes of the approved targets", async ({ page }) => {
  await openRoute(page, pipeline);
  const rows = page.locator("tr[data-index]");
  await expect(rows.first()).toBeVisible();

  // Approved means Qualified or later; read the names of those firms from the list.
  const approvedNames = new Set<string>();
  for (const stage of ["Qualified", "Outreach", "NDA", "IOI", "LOI", "Closed"]) {
    await page.goto(`/pipeline?stage=${stage}`);
    await page.waitForLoadState("networkidle");
    const n = await rows.count();
    for (let i = 0; i < n; i += 1) {
      approvedNames.add((await rows.nth(i).locator("td").first().innerText()).split("\n")[0]);
    }
  }
  expect(approvedNames.size).toBeGreaterThan(0);

  await page.goto("/pipeline");
  await page.waitForLoadState("networkidle");
  const button = page.getByRole("button", { name: "Find lookalikes of approved targets" });
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");

  const panel = approvedPanel(page);
  const items = panel.getByRole("list", { name: "Lookalikes of approved targets" }).locator("> li");
  await expect(items.first()).toBeVisible();
  const count = await items.count();
  expect(count).toBeLessThanOrEqual(20);

  const names = await items.getByRole("link").allInnerTexts();
  expect(new Set(names).size).toBe(names.length);
  for (const name of names) {
    expect(approvedNames.has(name.trim())).toBe(false);
  }
  await expect(items.first()).toContainText(/Closest to /);

  // Clicking one opens that firm's Desk.
  const first = items.first().getByRole("link").first();
  const name = (await first.innerText()).trim();
  await first.click();
  await expect(page).toHaveURL(/\/desk\?firmId=/);
  await expect(desk.heading(page).first()).toHaveText(name);
});

test("with no approved targets in view the pipeline says so", async ({ page }) => {
  await page.goto("/pipeline?stage=Discovered");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Find lookalikes of approved targets" }).click();
  await expect(approvedPanel(page)).toContainText("No approved targets in this view");
  await approvedPanel(page).getByRole("button", { name: "Close" }).click();
  await expect(approvedPanel(page)).toHaveCount(0);
  // Focus goes back to the toggle, which no longer points at a panel that is not there.
  const toggle = page.getByRole("button", { name: "Find lookalikes of approved targets" });
  await expect(toggle).toBeFocused();
  await expect(toggle).not.toHaveAttribute("aria-controls", /.+/);
});

test("lookalike panels keep to 390 px", async ({ page }) => {
  const id = await showcaseFirmId(page);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto(`/firm/${encodeURIComponent(id)}/tear-sheet`);
  await expect(moreLikeThis(page).getByRole("link").first()).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  await page.goto("/pipeline");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Find lookalikes of approved targets" }).click();
  await expect(approvedPanel(page).getByRole("link").first()).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

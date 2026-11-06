import { type Page, expect, test } from "@playwright/test";
import { ROUTES, openRoute } from "./routes";

const pipeline = ROUTES.find((r) => r.path === "/pipeline")!;
const rows = (page: Page) => page.locator("tr[data-index]");
const stageTab = (page: Page, stage: string) =>
  page.getByRole("radio", { name: new RegExp(`^${stage}`) });
const detail = (page: Page) => page.getByRole("complementary", { name: "Firm detail" });
const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test("the stage tabs filter the list and keep the URL in sync", async ({ page }) => {
  await openRoute(page, pipeline);
  await expect(stageTab(page, "All")).toBeChecked();
  const total = await rows(page).count();
  expect(total).toBeGreaterThan(1);

  await stageTab(page, "Passed").click();
  await expect(page).toHaveURL(/\/pipeline\?stage=Passed$/);
  await expect(stageTab(page, "Passed")).toBeChecked();
  await expect(rows(page).first().locator('[data-stage="Passed"]')).toBeVisible();
  await expect(rows(page).locator('[data-stage]:not([data-stage="Passed"])')).toHaveCount(0);

  await stageTab(page, "All").click();
  await expect(page).toHaveURL(/\/pipeline$/);
  await expect(rows(page).first()).toBeVisible();
});

test("the arrow keys move between stage tabs", async ({ page }) => {
  await page.goto("/pipeline?stage=Discovered");
  await expect(stageTab(page, "Discovered")).toBeChecked();

  await stageTab(page, "Discovered").focus();
  await page.keyboard.press("ArrowRight");

  await expect(stageTab(page, "Screening")).toBeChecked();
  await expect(page).toHaveURL(/stage=Screening$/);
});

test("the stage is read from the URL, and an unknown one shows every firm", async ({ page }) => {
  await page.goto("/pipeline?stage=nda");
  await expect(stageTab(page, "NDA")).toBeChecked();
  await expect(rows(page).locator('[data-stage="NDA"]').first()).toBeVisible();

  await page.goto("/pipeline?stage=Archived");
  await expect(stageTab(page, "All")).toBeChecked();
});

test("search and the profile filters narrow the list and the tab counts", async ({ page }) => {
  await openRoute(page, pipeline);
  const all = (await stageTab(page, "All").innerText()).replace(/\D/g, "");

  await page.getByRole("textbox", { name: "Search firms" }).fill("zzqx-no-such-firm");
  await expect(page.getByText("No firms match")).toBeVisible();
  await expect(stageTab(page, "All")).toContainText("0");

  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(stageTab(page, "All")).toContainText(all);

  await page.getByRole("combobox", { name: "Ownership" }).selectOption({ index: 1 });
  await expect(stageTab(page, "All")).not.toContainText(all);
});

test("a column header sorts the table and flips on a second click", async ({ page }) => {
  await openRoute(page, pipeline);
  const header = page.getByRole("columnheader", { name: /^Firm/ });
  await expect(page.getByRole("columnheader", { name: /^Stage/ })).toHaveAttribute(
    "aria-sort",
    "descending",
  );

  await header.getByRole("button").click();
  await expect(header).toHaveAttribute("aria-sort", "ascending");
  const first = (await rows(page).first().locator("td").first().innerText()).split("\n")[0];
  const second = (await rows(page).nth(1).locator("td").first().innerText()).split("\n")[0];
  expect(first.localeCompare(second)).toBeLessThanOrEqual(0);

  await header.getByRole("button").click();
  await expect(header).toHaveAttribute("aria-sort", "descending");
});

test("the arrow keys move between rows and Enter opens the firm", async ({ page }) => {
  await page.goto("/pipeline?stage=Qualified");
  await expect(rows(page).first()).toBeVisible();

  await rows(page).first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(rows(page).nth(1)).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(rows(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(detail(page)).toBeVisible();
});

test("selecting a firm opens its detail beside the list", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/pipeline?stage=Qualified");
  const row = rows(page).first();
  const name = (await row.locator("td").first().innerText()).split("\n")[0];

  await row.click();

  await expect(detail(page).getByRole("heading", { name, level: 2 })).toBeVisible();
  await expect(detail(page).getByRole("region", { name: "Fit score" })).toBeVisible();
  await expect(detail(page).getByText("Last activity")).toBeVisible();
  await detail(page).getByRole("button", { name: "Open in enrichment desk" }).click();
  await expect(page).toHaveURL(/\/desk\?firmId=/);
});

test("the detail panel closes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/pipeline?stage=Qualified");
  await rows(page).first().click();
  await expect(detail(page)).toBeVisible();

  await detail(page).getByRole("button", { name: "Close details" }).click();

  await expect(detail(page)).toBeHidden();
});

test("a firm that is out has no way into the desk, and says why", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/pipeline?stage=Passed");
  await rows(page).first().click();

  await expect(detail(page)).toContainText(/Hard-rejected|Pass reason|Reason not on file/);
  await expect(detail(page).getByRole("button", { name: "Open in enrichment desk" })).toHaveCount(
    0,
  );
});

test("under 1280 px the detail opens in a drawer", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto("/pipeline?stage=Qualified");
  await rows(page).first().click();

  const drawer = page.locator(".bp6-drawer");
  await expect(drawer.getByRole("button", { name: "Open in enrichment desk" })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});

test("under 900 px the table becomes cards, and the sort moves into a select", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/pipeline?stage=Qualified");

  const cards = page.getByRole("listbox", { name: "Firms" }).getByRole("option");
  await expect(cards.first()).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  await page.getByRole("combobox", { name: "Sort by" }).selectOption("name");
  await expect(page.locator("#main header")).toContainText("sorted by name");

  await cards.first().click();
  await expect(
    page.locator(".bp6-drawer").getByRole("button", { name: "Open in enrichment desk" }),
  ).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test("the palette shows the passed firms", async ({ page }) => {
  await openRoute(page, pipeline);

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill("show passed");
  await expect(palette.getByRole("option").first()).toContainText("Show passed firms");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/pipeline\?stage=Passed$/);
  await expect(stageTab(page, "Passed")).toBeChecked();
});

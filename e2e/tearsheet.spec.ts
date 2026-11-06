import { type Page, expect, test } from "@playwright/test";
import { ROUTES, openRoute } from "./routes";

const desk = ROUTES.find((r) => r.path === "/desk")!;
const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

/** Opens the desk on its showcase firm and returns the firm's id and name. */
async function showcaseFirm(page: Page): Promise<{ id: string; name: string }> {
  await openRoute(page, desk);
  await expect(page).toHaveURL(/\/desk\?firmId=/);
  const id = new URL(page.url()).searchParams.get("firmId")!;
  const name = (await desk.heading(page).first().innerText()).trim();
  return { id, name };
}

const tearSheetPath = (id: string) => `/firm/${encodeURIComponent(id)}/tear-sheet`;

test("tear sheet renders a showcase firm", async ({ page }) => {
  const { id, name } = await showcaseFirm(page);

  // The Desk header links to it.
  await page.getByRole("link", { name: "Tear sheet" }).click();
  await expect(page).toHaveURL(tearSheetPath(id));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);

  for (const section of [
    "Overview",
    "Score and tier",
    "Key evidence",
    "Open conflicts and abstentions",
    "Decision history",
  ]) {
    await expect(page.getByRole("heading", { level: 2, name: section })).toBeVisible();
  }

  // The score, with its per-axis breakdown.
  const score = page.getByRole("region", { name: "Score and tier" });
  await expect(score).toContainText(/\/ 18/);
  await expect(score.getByRole("table")).toBeVisible();
  await expect(score.getByRole("row")).not.toHaveCount(1);

  // Cited evidence: a quote, its provider and the model that read it.
  const evidence = page.getByRole("region", { name: "Key evidence" });
  await expect(evidence.locator("blockquote").first()).toBeVisible();
  await expect(evidence).toContainText(/Source: .+ · Read by /);

  // The showcase firm has an open conflict and an abstention; both are said in words.
  const open = page.getByRole("region", { name: "Open conflicts and abstentions" });
  await expect(open).toContainText("Sources disagree, not resolved");
  await expect(open).toContainText("No source supported a value, so Beacon did not guess.");
});

test("the tear sheet prints from its button and is named after the firm", async ({ page }) => {
  const { id, name } = await showcaseFirm(page);
  await page.goto(tearSheetPath(id));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  await expect(page).toHaveTitle(`Beacon — Tear sheet: ${name}`);

  await page.evaluate(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => {
      (window as unknown as { printed: number }).printed += 1;
    };
  });
  const button = page.getByRole("button", { name: "Print / Save as PDF" });
  await button.focus();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
});

test("print layout hides the shell", async ({ page }) => {
  const { id, name } = await showcaseFirm(page);
  await page.goto(tearSheetPath(id));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);

  // On screen the shell is there.
  const sidebar = page.getByRole("complementary", { name: "Workspace" });
  await expect(sidebar).toBeVisible();

  await page.emulateMedia({ media: "print" });
  await expect(sidebar).toBeHidden();
  await expect(page.getByRole("contentinfo", { name: "Status" })).toBeHidden();
  await expect(page.locator("#main").locator("xpath=preceding-sibling::header")).toBeHidden();
  await expect(page.getByRole("button", { name: "Print / Save as PDF" })).toBeHidden();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // Black on white, whatever the app theme is.
  const colours = await page.evaluate(() => ({
    page: getComputedStyle(document.body).backgroundColor,
    ink: getComputedStyle(document.querySelector("h1")!).color,
    note: getComputedStyle(document.querySelector("h2")!).color,
  }));
  expect(colours).toEqual({
    page: "rgb(255, 255, 255)",
    ink: "rgb(0, 0, 0)",
    note: "rgb(0, 0, 0)",
  });
  // The page flows rather than scrolling inside a viewport-high box.
  const scrolls = await page.evaluate(() => {
    const main = document.getElementById("main")!;
    return getComputedStyle(main).overflowY;
  });
  expect(scrolls).toBe("visible");

  // Going back to screen restores the shell.
  await page.emulateMedia({ media: "screen" });
  await expect(sidebar).toBeVisible();
});

test("the tear sheet keeps to 390 px, with one h1 and a quiet console", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      problems.push(msg.text());
    }
  });
  page.on("pageerror", (err) => problems.push(err.message));
  const { id, name } = await showcaseFirm(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(tearSheetPath(id));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  await page.waitForLoadState("networkidle");

  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.getByRole("main")).toHaveCount(1);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  expect(problems).toEqual([]);
});

test("an unknown firm says so", async ({ page }) => {
  await page.goto(tearSheetPath("no-such-firm"));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Firm not found");
  await expect(page.locator("h1")).toHaveCount(1);
});

test("the command palette opens the open firm's tear sheet", async ({ page }) => {
  const { id, name } = await showcaseFirm(page);

  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await page.keyboard.type("Tear sheet");
  await expect(page.getByRole("option").first()).toContainText(`Tear sheet: ${name}`);
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(tearSheetPath(id));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
});

test("the pipeline detail links to a passed firm's tear sheet", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/pipeline?stage=Passed");
  // The list is sorted once every firm has arrived; read the first row after that.
  await page.waitForLoadState("networkidle");
  const row = page.locator("tr[data-index]").first();
  const name = (await row.locator("td").first().innerText()).split("\n")[0];
  await row.click();

  await page
    .getByRole("complementary", { name: "Firm detail" })
    .getByRole("link", { name: "Tear sheet" })
    .click();

  await expect(page).toHaveURL(/\/firm\/.+\/tear-sheet$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  await expect(page.getByRole("region", { name: "Score and tier" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Decision history" })).toBeVisible();
});

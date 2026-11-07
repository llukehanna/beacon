import { expect, test } from "@playwright/test";
import { TOUR_FIRM_ID } from "../shared/showcaseFirms";
import { ROUTES, openRoute } from "./routes";

// Read-only checks of the wording and counts the recruiter review found confusing. They write
// nothing, so they sit between the specs that mutate the shared database without disturbing them.

const route = (path: string) => ROUTES.find((r) => r.path === path)!;
const numberIn = (text: string): number => Number(/(\d[\d,]*)/.exec(text)?.[1].replace(/,/g, ""));

test("home splits its headline into parts that match the Review badge", async ({ page }) => {
  await openRoute(page, route("/"));
  const parts = page.getByLabel("What needs you, by kind");
  const drift = parts.getByRole("link", { name: /drift to review/ });
  await expect(drift).toHaveAttribute("href", "/review");
  const badge = page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: /Review/ });
  expect(numberIn(await drift.innerText())).toBe(numberIn(await badge.innerText()));

  // The parts add up to the headline's total.
  const total = numberIn(await page.getByRole("heading", { level: 1 }).innerText());
  let sum = 0;
  for (const link of await parts.getByRole("link").all()) {
    sum += numberIn(await link.innerText());
  }
  expect(sum).toBe(total);
});

test("home says its agent activity is a replay and counts dropped values", async ({ page }) => {
  await openRoute(page, route("/"));
  const feed = page.getByRole("region", { name: "Agent activity" });
  await expect(feed).toContainText("Replayed from the recorded Claude Haiku 4.5 extraction run");

  const card = page.getByRole("link", { name: /Passed grounding/ });
  await expect(card).toHaveAttribute("href", "/accuracy?tab=evals");
  await expect(card).toContainText(/\d+\.\d%/);
  await expect(card).toContainText(/extracted values passed grounding · [\d,]+ dropped/);
});

test("the desk says what the run is and counts axes the way the rubric does", async ({ page }) => {
  await page.goto(`/desk?firmId=${TOUR_FIRM_ID}`);
  const run = page.getByRole("region", { name: "Agent run" });
  await expect(
    page.getByText(/^Replayed from the recorded Claude Haiku 4\.5 extraction run/),
  ).toBeVisible();
  await expect(run.getByRole("button", { name: "Replay run" })).toHaveAttribute(
    "title",
    /no model is called/,
  );

  const grid = page.getByRole("region", { name: "Axes by source" });
  await expect(grid).toContainText(/\d scored axes? \+ 4 gates\. \d more of the 9 scored axes/);
  await expect(page.getByRole("region", { name: "Your call" })).toContainText(
    /\d of 9 scored axes on file/,
  );
  await expect(page.getByRole("region", { name: "Your call" })).not.toContainText("axes known");
});

test("a tear sheet opened from the Desk names the Desk as where it came from", async ({ page }) => {
  await page.goto(`/desk?firmId=${TOUR_FIRM_ID}`);
  await page.getByRole("link", { name: "Tear sheet" }).first().click();
  await expect(page).toHaveURL(/\/tear-sheet$/);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Desk");
  await expect(page.getByRole("link", { name: "Desk", exact: true }).last()).toHaveAttribute(
    "href",
    "/desk",
  );

  // Opened any other way, it reads as coming from the Pipeline.
  await page.goto("/");
  await page.goto(`/firm/${TOUR_FIRM_ID}/tear-sheet`);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Pipeline");
});

test("an active rule says how many of the firms it screens are still open", async ({ page }) => {
  await openRoute(page, route("/rules"));
  await expect(page.getByRole("region", { name: "Active rules" })).toContainText(
    /\d+ firms? \(\d+ still open\)/,
  );
});

test("mandates say what is in scope, in plain words", async ({ page }) => {
  await openRoute(page, route("/mandate"));
  const main = page.locator("#main");
  await expect(main).toContainText(
    /\d+ firms in scope · (no search run yet|\d+ added by searches)/,
  );
  await expect(main).toContainText("A firm can be in the scope of several mandates");
  await expect(main).not.toContainText("from searches");
  await expect(main).not.toContainText(/Searches that/);
});

test("on a phone the keyboard hints are gone and a rule expression wraps", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRoute(page, route("/"));
  await expect(page.locator("kbd:visible")).toHaveCount(0);

  await openRoute(page, route("/rules"));
  const rule = page.locator("code").first();
  await expect(rule).toBeVisible();
  const clipped = await rule.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(clipped, "the rule expression is cut off").toBe(false);
});

test("the queue says how it is sorted and shows the gain", async ({ page }) => {
  await page.goto("/desk");
  await expect(page.getByText("most points to gain first")).toBeVisible();
  await expect(page.getByTitle(/^Up to \+\d+ points if enriched$/).first()).toBeVisible();
});

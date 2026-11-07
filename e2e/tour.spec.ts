import { type Locator, type Page, expect, test } from "@playwright/test";
import { TOUR_FIRM_ID } from "../shared/showcaseFirms";
import { ROUTES, openRoute } from "./routes";

const home = ROUTES.find((r) => r.path === "/")!;

/** The six stops: the route each lives on and the element it points at. */
const STOPS = [
  { route: "/mandate", anchor: "mandate" },
  { route: "/desk", anchor: "conflict-row" },
  { route: "/desk", anchor: "evidence" },
  { route: "/desk", anchor: "pass-button" },
  { route: "/rules", anchor: "proposed-rule" },
  { route: "/review", anchor: "drift-list" },
];

type Rect = { top: number; left: number; width: number; height: number };

async function rectOf(locator: Locator): Promise<Rect> {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error("element has no box");
  }
  return { top: box.y, left: box.x, width: box.width, height: box.height };
}

const intersects = (a: Rect, b: Rect): boolean =>
  a.left < b.left + b.width &&
  b.left < a.left + a.width &&
  a.top < b.top + b.height &&
  b.top < a.top + a.height;

/** Starts the tour from Home's intro card and walks it with Next, checking every stop. */
async function walkTour(page: Page, narrow: boolean): Promise<void> {
  await openRoute(page, home);
  await page.getByRole("button", { name: "Take the 60-second tour" }).click();

  for (const [i, stop] of STOPS.entries()) {
    await expect(page).toHaveURL(new RegExp(`${stop.route}\\?(.*&)?tour=${i + 1}(&|$)`));
    const card = page.locator("[data-tour-card]");
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText(`${i + 1} of 6`);
    await expect(card.getByRole("heading", { level: 2 })).toBeVisible();

    const anchor = page.locator(`[data-tour="${stop.anchor}"]`).first();
    await expect(anchor).toBeVisible();
    const spotlight = page.locator("[data-tour-spotlight]");
    await expect(spotlight).toBeVisible();

    // The outline hugs the anchor (4 px of padding on each side) once the page has settled.
    await expect
      .poll(async () => {
        const a = await rectOf(anchor);
        const s = await rectOf(spotlight);
        return [s.left - a.left, s.top - a.top, s.width - a.width, s.height - a.height].map(
          Math.round,
        );
      })
      .toEqual([-4, -4, 8, 8]);

    if (narrow) {
      // Settled: the card sits clear of the thing it points at.
      await expect
        .poll(async () => intersects(await rectOf(card), await rectOf(anchor)), {
          message: `the card covers the anchor at stop ${i + 1}`,
        })
        .toBe(false);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, "horizontal page scroll").toBeLessThanOrEqual(0);
    }

    if (i < STOPS.length - 1) {
      await card.getByRole("button", { name: /^Next/ }).click();
    }
  }

  const card = page.locator("[data-tour-card]");
  await expect(card.getByRole("link", { name: "See how accurate it is" })).toHaveAttribute(
    "href",
    "/accuracy",
  );
  await expect(card.getByRole("link", { name: "About Beacon" })).toHaveAttribute("href", "/about");
}

test("tour completes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await walkTour(page, false);
});

test("tour completes at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await walkTour(page, true);
});

test("the Desk stops open on a strong firm, not on whichever leads the queue", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/mandate?tour=1");
  const card = page.locator("[data-tour-card]");
  await card.getByRole("button", { name: /^Next/ }).click();
  await expect(page).toHaveURL(new RegExp(`/desk\\?firmId=${TOUR_FIRM_ID}&tour=2$`));
  await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText("Mallowick Partners");

  // Mostly filled in: one conflict, at most two abstentions, and already in tier B or better.
  const summary = page.getByText(/\d+ conflicts? · \d+ proposed · \d+ abstained · \d+ verified/);
  const [, conflicts, proposed, abstained, verified] =
    /(\d+) conflicts? · (\d+) proposed · (\d+) abstained · (\d+) verified/
      .exec(await summary.innerText())!
      .map(Number);
  expect(conflicts).toBe(1);
  expect(abstained).toBeLessThanOrEqual(2);
  expect(proposed + verified).toBeGreaterThanOrEqual(6);
  await expect(
    page
      .locator("#main")
      .getByText(/^Tier [AB]$/)
      .first(),
  ).toBeVisible();
  await expect(page.getByTestId("projected-score")).toContainText(/Tier [AB]/);

  // The firm stays put through the Desk's three stops.
  await card.getByRole("button", { name: /^Next/ }).click();
  await card.getByRole("button", { name: /^Next/ }).click();
  await expect(page).toHaveURL(new RegExp(`firmId=${TOUR_FIRM_ID}&tour=4$`));

  // A stop reached without a firm in the URL is given the tour's.
  await page.goto("/desk?tour=3");
  await expect(page).toHaveURL(new RegExp(`firmId=${TOUR_FIRM_ID}`));
  await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText("Mallowick Partners");
});

test("tour writes nothing", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && new URL(req.url()).pathname === "/api/actions") {
      writes.push(req.url());
    }
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await walkTour(page, false);
  await page.getByRole("button", { name: "Done" }).click();
  await page.waitForLoadState("networkidle");

  expect(writes).toEqual([]);
});

test("the arrow keys move through the tour and Esc closes it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRoute(page, home);
  await page.getByRole("button", { name: "Take the 60-second tour" }).click();
  const card = page.locator("[data-tour-card]");
  await expect(card).toContainText("1 of 6");
  // Focus moved to the card.
  await expect(card).toBeFocused();

  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/desk\?.*tour=2/);
  await expect(card).toContainText("2 of 6");
  await page.keyboard.press("ArrowLeft");
  await expect(page).toHaveURL(/\/mandate\?tour=1/);
  await expect(card).toContainText("1 of 6");

  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  await expect(page).toHaveURL(/\/mandate$/);
});

test("Back and a reload stay on the same stop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/rules?tour=5");
  const card = page.locator("[data-tour-card]");
  await expect(card).toContainText("5 of 6");
  await expect(page.locator('[data-tour="proposed-rule"]').first()).toBeVisible();

  await card.getByRole("button", { name: /^Next/ }).click();
  await expect(card).toContainText("6 of 6");
  await page.goBack();
  await expect(card).toContainText("5 of 6");

  await page.reload();
  await expect(card).toContainText("5 of 6");
});

test("the palette and the shortcut list start the tour", async ({ page }) => {
  await openRoute(page, home);
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill("take the tour");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/mandate\?tour=1/);
  await expect(page.locator("[data-tour-card]")).toContainText("1 of 6");

  await page.keyboard.press("Escape");
  await page.goto("/");
  await page.keyboard.press("?");
  await page
    .getByRole("dialog", { name: "Keyboard shortcuts" })
    .getByRole("button", { name: "Take the 60-second tour" })
    .click();
  await expect(page).toHaveURL(/\/mandate\?tour=1/);
});

test("intro stays dismissed after reload", async ({ page }) => {
  await openRoute(page, home);
  const intro = page.getByRole("region", { name: /sourcing desk/ });
  await expect(intro).toBeVisible();
  await intro.getByRole("link", { name: "About" }).waitFor();
  await expect(intro.getByRole("link", { name: /GitHub/ })).toHaveAttribute(
    "href",
    "https://github.com/llukehanna/beacon",
  );
  await expect(intro.getByRole("link", { name: /Luke Hanna/ })).toHaveAttribute(
    "href",
    "https://lukeghanna.com",
  );

  await intro.getByRole("button", { name: "Dismiss the introduction" }).click();
  await expect(intro).toBeHidden();

  await page.reload();
  await expect(home.heading(page).first()).toBeVisible();
  await expect(intro).toHaveCount(0);
});

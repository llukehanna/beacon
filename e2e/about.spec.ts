import { expect, test } from "@playwright/test";
import { ROUTES, openRoute } from "./routes";

const home = ROUTES.find((r) => r.path === "/")!;
const about = ROUTES.find((r) => r.path === "/about")!;
const trust = ROUTES.find((r) => r.path === "/trust")!;

test("the home intro links through to About", async ({ page }) => {
  await openRoute(page, home);
  await page
    .getByRole("region", { name: /sourcing desk/ })
    .getByRole("link", { name: "About" })
    .click();

  await expect(page).toHaveURL(/\/about$/);
  await expect(about.heading(page)).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "The problem" })).toBeVisible();
});

test("the tour's last card links through to About and ends the tour", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/review?tour=6");
  const card = page.locator("[data-tour-card]");
  await expect(card).toContainText("6 of 6");

  await card.getByRole("link", { name: "About Beacon" }).click();

  await expect(page).toHaveURL(/\/about$/);
  await expect(about.heading(page)).toBeVisible();
  await expect(card).toHaveCount(0);
});

test("about links to the tour", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRoute(page, about);

  await page.getByRole("button", { name: "Take the 60-second tour" }).click();

  await expect(page).toHaveURL(/\/mandate\?tour=1$/);
  const card = page.locator("[data-tour-card]");
  await expect(card).toBeVisible();
  await expect(card).toContainText("1 of 6");
});

test("the sidebar footer reaches About and Trust, and Trust links the security doc", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRoute(page, home);
  const footer = page.getByRole("navigation", { name: "About and trust" });

  await footer.getByRole("link", { name: "Trust" }).click();
  await expect(page).toHaveURL(/\/trust$/);
  await expect(trust.heading(page)).toBeVisible();
  await expect(footer.getByRole("link", { name: "Trust" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: /docs\/security\.md/ }).first()).toHaveAttribute(
    "href",
    "https://github.com/llukehanna/beacon/blob/main/docs/security.md",
  );
  await footer.getByRole("link", { name: "About" }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(about.heading(page)).toBeVisible();
});

test("the tour's evidence stop encloses the source excerpt and the grounding checks", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/desk?tour=3");
  const anchor = page.locator('[data-tour="evidence"]').first();
  await expect(anchor).toBeVisible();

  await expect(anchor.getByRole("figure", { name: "Source document" })).toBeVisible();
  await expect(anchor.getByRole("list", { name: "Grounding checks" })).toBeVisible();
});

test("requests the browser abandons do not raise the Vite error overlay", async ({ page }) => {
  // Navigating away from a page that is still loading abandons its API requests. The dev server
  // used to hand each one to Vite as an error, and Vite showed it as an overlay on whichever page
  // was open when it arrived: that made the tests above fail at random.
  await page.goto("/about");
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    for (let i = 0; i < 150; i++) {
      const abort = new AbortController();
      const options = { signal: abort.signal };
      void fetch(`/api/objects?type=Firm&pageSize=1000&n=${i}`, options).catch(() => undefined);
      void fetch(`/api/functions?name=shellCounts&n=${i}`, options).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, i % 4));
      abort.abort();
    }
  });
  // One request that is not abandoned, answered after the dev server has dealt with the others,
  // then the network going quiet: Vite sends an error to the page right after the failed request.
  expect((await page.request.get("/api/functions?name=shellCounts")).ok()).toBe(true);
  await page.waitForLoadState("networkidle");
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
});

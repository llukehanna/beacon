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

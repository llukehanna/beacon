import { expect, test } from "@playwright/test";
import { ROUTES, openRoute } from "./routes";

const route = (path: string) => {
  const found = ROUTES.find((r) => r.path === path);
  if (found === undefined) {
    throw new Error(`no route ${path}`);
  }
  return found;
};

// Nothing here submits a decision: these tests leave the shared database as they found it.

test("a proposed rule can be declined only with a reason, and the form cancels", async ({
  page,
}) => {
  await openRoute(page, route("/rules"));
  const panel = page.getByRole("region", { name: /deal_size_usd_m/ });
  await panel.getByRole("button", { name: "Decline…" }).click();

  const decline = panel.getByRole("button", { name: "Decline", exact: true });
  await expect(decline).toBeDisabled();
  await panel.getByLabel("Reason to decline this proposal").fill("Below our floor");
  await expect(decline).toBeEnabled();

  await panel.getByRole("button", { name: "Cancel" }).click();
  await expect(panel.getByRole("button", { name: "Approve" })).toBeVisible();
});

test("a proposed rule lists the rejections it came from", async ({ page }) => {
  await openRoute(page, route("/rules"));
  const panel = page.getByRole("region", { name: /deal_size_usd_m/ });

  await expect(panel.getByText(/Based on \d+ rejections?/)).toBeVisible();
  await expect(panel.getByRole("list", { name: "Analyst rejection notes" })).toBeVisible();
  await panel.getByRole("button", { name: /Show all \d+ notes/ }).click();
  await expect(panel.getByRole("button", { name: "Show fewer" })).toBeVisible();
});

test("an active rule opens its details, an amend form and an unapprove prompt", async ({
  page,
}) => {
  await openRoute(page, route("/rules"));
  const rules = page.getByRole("region", { name: "Active rules" });
  await expect(rules.getByRole("cell", { name: /employees < 10/ })).toBeVisible();

  await rules.getByRole("button", { name: "Amend threshold…" }).click();
  await expect(page.getByLabel("New threshold value")).toBeFocused();
  await expect(rules.getByRole("button", { name: "Save" })).toBeEnabled();
  await rules.getByRole("button", { name: "Cancel" }).click();

  await rules.getByRole("button", { name: "Unapprove" }).click();
  await expect(page.getByRole("alertdialog", { name: "Unapprove this rule?" })).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();

  await rules.getByRole("button", { name: "Details" }).click();
  await expect(rules.getByText(/Based on \d+ rejections?/)).toBeVisible();
});

test("the rules page registers its actions in the palette", async ({ page }) => {
  await openRoute(page, route("/rules"));
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await page.keyboard.type("propose");
  await expect(
    palette.getByRole("option", { name: /Propose rules from rejections/ }),
  ).toBeVisible();
});

test("accuracy keeps its breakdowns, outcomes and the passed-then-acquired line", async ({
  page,
}) => {
  await openRoute(page, route("/accuracy"));

  await expect(page.getByRole("region", { name: "By provider" })).toBeVisible();
  await expect(page.getByRole("region", { name: "By axis" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Outcomes" })).toBeVisible();
  await expect(page.getByText(/Of firms we passed,/)).toBeVisible();
  await expect(page.getByText(/firms? with no outcome observed yet/)).toBeVisible();
});

test("a mandate card opens that mandate's search page, which keeps its picks", async ({ page }) => {
  await openRoute(page, route("/mandate"));
  await expect(page.getByRole("link", { name: "Work in desk →" }).first()).toBeVisible();

  await page
    .getByRole("link", { name: /Interpret & run search/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/search\/[^/]+$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Interpret & run search" }),
  ).toBeVisible();

  // The mandate's own words pre-fill the pickers; this test is about picking by hand.
  // Wait for the pre-fill to land first, or it could toggle a pick made below.
  await expect(page.getByRole("group", { name: "Read from the mandate" })).toBeVisible();
  const readBack = page.getByRole("button", { name: /^Remove .* \(read from/ });
  while ((await readBack.count()) > 0) {
    await readBack.first().click();
  }
  await expect(page.getByText(/No filters picked/)).toBeVisible();

  const geography = page.getByRole("group", { name: "Geography" });
  const europe = geography.getByRole("button", { name: /^Europe/ });
  await europe.click();
  await expect(europe).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByText("9 filters across geography, products, and industries."),
  ).toBeVisible();
  await europe.click();
  await expect(page.getByText(/No filters picked/)).toBeVisible();

  await page.getByLabel("Add custom geography").fill("Narnia");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Remove Narnia" })).toBeVisible();
  await page.getByRole("button", { name: "Remove Narnia" }).click();
  await expect(page.getByRole("button", { name: "Remove Narnia" })).toHaveCount(0);
});

test("interpret pre-fills filters from the mandate", async ({ page }) => {
  await openRoute(page, route("/mandate"));
  await page
    .getByRole("region", { name: /European mid-market advisory/ })
    .getByRole("link", { name: /Interpret & run search/ })
    .click();
  await expect(page).toHaveURL(/\/search\/[^/]+$/);

  const strip = page.getByRole("group", { name: "Read from the mandate" });
  const europeChip = strip.getByRole("listitem").filter({ hasText: "geography: Europe" });
  await expect(europeChip).toBeVisible();
  await expect(europeChip).toContainText("“European”");

  const geography = page.getByRole("group", { name: "Geography" });
  const europe = geography.getByRole("button", { name: /^Europe/ });
  await expect(europe).toHaveAttribute("aria-pressed", "true");
  // Reading the mandate never runs the search.
  await expect(page).toHaveURL(/\/search\//);
  await expect(page.getByRole("button", { name: "Run search" })).toBeEnabled();

  await europeChip.getByRole("button", { name: /^Remove Europe/ }).click();
  await expect(europeChip).toHaveCount(0);
  await expect(europe).toHaveAttribute("aria-pressed", "false");

  // A pick of the visitor's own is not undone by anything the page does afterwards.
  await europe.click();
  await expect(europe).toHaveAttribute("aria-pressed", "true");
});

test("moving from one mandate's search to another's leaves the first one's picks behind", async ({
  page,
}) => {
  await openRoute(page, route("/mandate"));
  await page
    .getByRole("region", { name: /European mid-market advisory/ })
    .getByRole("link", { name: /Interpret & run search/ })
    .click();
  const geography = page.getByRole("group", { name: "Geography" });
  const europe = geography.getByRole("button", { name: /^Europe/ });
  await expect(europe).toHaveAttribute("aria-pressed", "true");
  const strip = page.getByRole("group", { name: "Read from the mandate" });
  await expect(strip).toContainText("Europe");

  // Straight from one search page to the other: the palette's mandate command.
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await page.keyboard.type("Private credit advisory");
  await palette.getByRole("option", { name: /Private credit advisory specialists/ }).click();

  await expect(
    page.getByRole("heading", { level: 2, name: /Private credit advisory/ }),
  ).toBeVisible();
  await expect(strip.getByRole("listitem")).toHaveCount(1);
  await expect(strip).toContainText("Private credit advisory");
  await expect(strip).not.toContainText("Europe");
  await expect(europe).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByText("1 filter across geography, products, and industries."),
  ).toBeVisible();
});

test("the pre-fill never overwrites what the visitor picked", async ({ page }) => {
  await openRoute(page, route("/mandate"));
  const link = page
    .getByRole("region", { name: /European mid-market advisory/ })
    .getByRole("link", { name: /Interpret & run search/ });
  const href = await link.getAttribute("href");
  expect(href).not.toBeNull();

  // Picked after the pre-fill, then the page re-renders under a new query string.
  await link.click();
  const geography = page.getByRole("group", { name: "Geography" });
  const asia = geography.getByRole("button", { name: /^Asia-Pacific/ });
  const europe = geography.getByRole("button", { name: /^Europe/ });
  await expect(europe).toHaveAttribute("aria-pressed", "true");
  await asia.click();
  await page.evaluate(() => {
    history.pushState({}, "", `${location.pathname}?again=1`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page).toHaveURL(/again=1/);
  await expect(asia).toHaveAttribute("aria-pressed", "true");
  await expect(europe).toHaveAttribute("aria-pressed", "true");

  // Picked before the mandate has loaded: the mandate's reading is not applied on top.
  await page.route("**/api/objects?*", async (r) => {
    await new Promise((done) => setTimeout(done, 1500));
    await r.continue();
  });
  await page.goto(href ?? "/");
  await asia.click();
  await expect(asia).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("heading", { level: 2, name: /European mid-market advisory/ }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("group", { name: "Read from the mandate" })).toHaveCount(0);
  await expect(asia).toHaveAttribute("aria-pressed", "true");
  await expect(europe).toHaveAttribute("aria-pressed", "false");
});

test("taking back one chip leaves the other chips' picks", async ({ page }) => {
  await openRoute(page, route("/mandate"));
  await page
    .getByRole("region", { name: /Sector-focused sell-side M&A/ })
    .getByRole("link", { name: /Interpret & run search/ })
    .click();
  const strip = page.getByRole("group", { name: "Read from the mandate" });
  const geography = page.getByRole("group", { name: "Geography" });
  const us = strip.getByRole("listitem").filter({ hasText: "geography: United States" });
  const canada = strip.getByRole("listitem").filter({ hasText: "geography: Canada" });
  await expect(us).toBeVisible();
  await expect(canada).toBeVisible();
  await expect(geography.getByRole("button", { name: "United States" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await canada.getByRole("button", { name: /^Remove Canada/ }).click();
  await expect(geography.getByRole("button", { name: "Canada" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(geography.getByRole("button", { name: "United States" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(us).toBeVisible();
});

test("the search page fits a 390px screen with the longest chips", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRoute(page, route("/mandate"));
  await page
    .getByRole("region", { name: /Sector-focused sell-side M&A/ })
    .getByRole("link", { name: /Interpret & run search/ })
    .click();
  const strip = page.getByRole("group", { name: "Read from the mandate" });
  await expect(strip.getByRole("listitem")).toHaveCount(4);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  // The longest chip any mandate can produce also fits: swap its text in and measure again.
  await strip
    .getByRole("listitem")
    .first()
    .locator("span")
    .first()
    .evaluate((el) => {
      el.textContent =
        "\u201Cspecial committee\u201D \u2192 products: Board & special committee advisory";
    });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
  // Every chip, and its remove button, stays inside the screen.
  for (const box of await strip
    .locator("li, button")
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right))) {
    expect(box).toBeLessThanOrEqual(390);
  }
});

test("removing every chip hides the strip", async ({ page }) => {
  await openRoute(page, route("/mandate"));
  await page
    .getByRole("region", { name: /Private credit advisory specialists/ })
    .getByRole("link", { name: /Interpret & run search/ })
    .click();
  const strip = page.getByRole("group", { name: "Read from the mandate" });
  await expect(strip.getByRole("listitem")).toHaveCount(1);
  await strip.getByRole("button", { name: /^Remove / }).click();
  await expect(strip).toHaveCount(0);
});

test("an unknown path shows the not-found page inside the shell", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (err) => problems.push(err.message));
  await page.goto("/no-such-page");

  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to Home" })).toBeVisible();
  await expect(page.getByRole("navigation").first()).toBeVisible();
  expect(problems).toEqual([]);
});

test("an active rule's toggle closes an open amend form without opening the details", async ({
  page,
}) => {
  await openRoute(page, route("/rules"));
  const rules = page.getByRole("region", { name: "Active rules" });
  await rules.getByRole("button", { name: "Amend threshold…" }).click();
  await expect(page.getByLabel("New threshold value")).toBeVisible();

  await rules.getByRole("button", { name: "Hide details" }).click();

  await expect(page.getByLabel("New threshold value")).toHaveCount(0);
  await expect(rules.getByText(/Based on \d+ rejections?/)).toHaveCount(0);
  await expect(rules.getByRole("button", { name: "Details" })).toBeVisible();
});

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

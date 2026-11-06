import { expect, test } from "@playwright/test";
import { ROUTES, openRoute } from "./routes";

const route = (path: string) => {
  const found = ROUTES.find((r) => r.path === path);
  if (found === undefined) {
    throw new Error(`no route ${path}`);
  }
  return found;
};

test("g then u opens rules", async ({ page }) => {
  await openRoute(page, route("/"));

  await page.keyboard.press("g");
  await page.keyboard.press("u");

  await expect(page).toHaveURL(/\/rules$/);
  await expect(route("/rules").heading(page).first()).toBeVisible();
});

test("go keys stay out of text fields", async ({ page }) => {
  await openRoute(page, route("/pipeline"));
  const search = page.getByRole("textbox").first();

  await search.click();
  await page.keyboard.type("gu");

  await expect(page).toHaveURL(/\/pipeline$/);
  await expect(search).toHaveValue("gu");
});

test("? opens the shortcuts overlay", async ({ page }) => {
  await openRoute(page, route("/"));

  await page.keyboard.press("?");

  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Rules", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("the sidebar marks the current route and shows live counts", async ({ page }) => {
  await openRoute(page, route("/review"));

  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav.getByRole("link", { name: /^Review/ })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: /^Home/ })).not.toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("contentinfo", { name: "Status" })).toContainText(/\d+ need review/);
});

test("status bar reports an unreachable server", async ({ page }) => {
  await openRoute(page, route("/"));
  await expect(page.getByText(/Synced \d+s ago/)).toBeVisible();

  await page.route("**/api/**", (r) => r.fulfill({ status: 500, body: "{}" }));
  // Opening another screen makes queries that cannot be answered.
  await page.keyboard.press("g");
  await page.keyboard.press("p");

  await expect(page.getByText("Can't reach server")).toBeVisible({ timeout: 15_000 });
});

test("reset button still resets", async ({ page }) => {
  await openRoute(page, route("/"));

  await page.getByRole("button", { name: "Reset demo" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reset", exact: true }).click();

  await expect(page.getByText("Demo data restored.")).toBeVisible();
});

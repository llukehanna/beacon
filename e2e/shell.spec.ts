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

test("command palette opens a firm", async ({ page }) => {
  // The desk lands on a showcase firm; its name is the page heading.
  await openRoute(page, route("/desk"));
  const name = (await route("/desk").heading(page).first().innerText()).trim();
  expect(name.length).toBeGreaterThan(3);
  await openRoute(page, route("/"));

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await expect(page.getByRole("combobox")).toBeFocused();

  await page.keyboard.type(name);
  await expect(palette.getByRole("option").first()).toContainText(name);
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/desk\?firmId=/);
  await expect(palette).toBeHidden();
  await expect(route("/desk").heading(page).first()).toHaveText(name);
});

test("slash opens the palette outside text fields and escape closes it", async ({ page }) => {
  await openRoute(page, route("/"));

  await page.keyboard.press("/");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await expect(page.getByRole("combobox")).toHaveValue("");

  await page.keyboard.type("rul");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/rules$/);

  // Typing a slash into a text field must not open it.
  await openRoute(page, route("/pipeline"));
  await page.getByRole("textbox").first().click();
  await page.keyboard.type("a/b");
  await expect(palette).toBeHidden();

  await page.getByRole("button", { name: "Search and commands" }).click();
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
});

test("a mandate result opens that mandate's page", async ({ page }) => {
  await openRoute(page, route("/"));

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  const mandates = palette.getByRole("group", { name: "Mandates" }).getByRole("option");
  const label = (await mandates.nth(1).innerText()).trim();
  await mandates.nth(1).click();

  await expect(page).toHaveURL(/\/search\/[^/]+$/);
  await expect(palette).toBeHidden();
  await expect(page.getByText(label.slice(0, 20), { exact: false }).first()).toBeVisible();
});

test("the palette says firms are loading instead of reporting no match", async ({ page }) => {
  await openRoute(page, route("/"));
  // Slow the firm list so the palette opens before it arrives.
  await page.route("**/api/objects?**", async (r) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await r.continue();
  });

  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("zzqx");
  await expect(page.getByText("Loading firms…")).toBeVisible();
  await expect(page.getByText(/No match for/)).toHaveCount(0);

  await expect(page.getByText(/No match for/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Loading firms…")).toHaveCount(0);
});

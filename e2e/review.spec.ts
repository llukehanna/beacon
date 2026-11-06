import { type Page, expect, test } from "@playwright/test";
import { ROUTES, openRoute } from "./routes";

// The last test resolves a drift event, so these run in file order.
test.describe.configure({ mode: "serial" });

const review = ROUTES.find((r) => r.path === "/review")!;
const queueRows = (page: Page) => page.locator("button[data-drift]:not([data-resolved])");
const resolvedRows = (page: Page) => page.locator("button[data-drift][data-resolved]");
const detail = (page: Page) => page.getByRole("complementary", { name: "Drift detail" });
const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test("review lists the open drift events, then the resolved ones", async ({ page }) => {
  await openRoute(page, review);

  const open = await queueRows(page).count();
  expect(open).toBeGreaterThan(1);
  await expect(page.getByRole("region", { name: "Needs review" })).toContainText(String(open));
  await expect(page.locator("#main header")).toContainText(`${open} firm`);
  // The status bar and the sidebar count the same open events.
  await expect(page.getByRole("contentinfo", { name: "Status" })).toContainText(
    `${open} need review`,
  );
  await expect(resolvedRows(page).first()).toBeVisible();
});

test("the first open event is selected, and the detail names the tier it moved between", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRoute(page, review);

  await expect(queueRows(page).first()).toHaveAttribute("aria-pressed", "true");
  const panel = detail(page);
  await expect(panel.getByRole("heading", { level: 2 })).toBeVisible();
  const tiers = panel.getByRole("region", { name: "Tier change" });
  await expect(tiers).toContainText("At decision");
  await expect(tiers).toContainText("Now");
});

test("selecting another event changes the detail, and the arrow keys move between rows", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRoute(page, review);
  const heading = detail(page).getByRole("heading", { level: 2 });
  const first = (await heading.innerText()).trim();

  await queueRows(page).first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(queueRows(page).nth(1)).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(queueRows(page).nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(heading).not.toHaveText(first);
});

test("a resolved event shows how it was settled and offers no decision", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRoute(page, review);

  await resolvedRows(page).first().click();

  await expect(detail(page)).toContainText(
    /Re-engaged|Kept passed|Kept in pipeline|Passed|Resolved/,
  );
  await expect(detail(page).getByRole("button", { name: "Pass…" })).toHaveCount(0);
  await expect(detail(page).getByRole("button", { name: "Keep passed…" })).toHaveCount(0);
});

test("a firm in the pipeline can be kept or passed, a passed firm re-engaged or kept passed", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRoute(page, review);
  const seen = new Set<string>();

  const count = await queueRows(page).count();
  for (let i = 0; i < count; i += 1) {
    await queueRows(page).nth(i).click();
    for (const name of ["Keep in pipeline", "Pass…", "Re-engage", "Keep passed…"]) {
      if (await detail(page).getByRole("button", { name, exact: true }).isVisible()) {
        seen.add(name);
      }
    }
  }

  expect([...seen].sort()).toEqual(["Keep in pipeline", "Keep passed…", "Pass…", "Re-engage"]);
});

test("under 1280 px the detail opens in a drawer", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await openRoute(page, review);
  await expect(page.locator(".bp6-drawer")).toHaveCount(0);

  await queueRows(page).first().click();

  const drawer = page.locator(".bp6-drawer");
  await expect(drawer.getByRole("region", { name: "Tier change" })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});

test("on a phone the queue stacks and nothing scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openRoute(page, review);

  await expect(queueRows(page).first()).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test("the palette moves to the next open event", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRoute(page, review);
  await expect(queueRows(page).first()).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill("next drift");
  await expect(palette.getByRole("option").first()).toContainText("Review next drift item");
  await page.keyboard.press("Enter");

  await expect(queueRows(page).nth(1)).toHaveAttribute("aria-pressed", "true");
});

test("keeping a firm passed needs a note, and resolves the event", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRoute(page, review);
  const open = await queueRows(page).count();

  // Find an open event on a passed firm: its detail offers "Keep passed…".
  const keep = detail(page).getByRole("button", { name: "Keep passed…" });
  for (let i = 0; i < open && !(await keep.isVisible()); i += 1) {
    await queueRows(page).nth(i).click();
  }
  await expect(keep).toBeVisible();
  const selected = page.locator("button[data-drift][aria-pressed='true']");
  const id = await selected.getAttribute("data-drift");

  await keep.click();
  const submit = detail(page).getByRole("button", { name: "Keep passed", exact: true });
  await expect(submit).toBeDisabled();
  await detail(page)
    .getByRole("textbox", { name: "Reason to keep this firm passed" })
    .fill("Still outside the mandate after the change.");
  await expect(submit).toBeEnabled();
  await submit.click();

  // The event moves to Resolved and says how it was settled.
  const row = page.locator(`button[data-drift="${id}"]`);
  await expect(row).toHaveAttribute("data-resolved", "true");
  await expect(row).toContainText("Kept passed");
  await expect(queueRows(page)).toHaveCount(open - 1);
});

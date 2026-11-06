import { expect, test } from "@playwright/test";
import { ROUTES, openRoute } from "./routes";

const home = ROUTES.find((r) => r.path === "/")!;

const STAGES = [
  "Discovered",
  "Screening",
  "Qualified",
  "Outreach",
  "NDA",
  "IOI",
  "LOI",
  "Closed",
  "Passed",
];

// 640-720 and 900-960 are where nine columns are narrowest (the sidebar takes 228 px from 900).
for (const width of [1440, 960, 900, 768, 720, 680, 640, 390]) {
  test(`home funnel shows every stage on one line at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openRoute(page, home);

    for (const stage of STAGES) {
      const label = page.locator(`a[data-stage="${stage}"]`).getByText(stage, { exact: true });
      await expect(label, stage).toBeVisible();
      const lineHeight = await label.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
      const box = await label.boundingBox();
      expect(box!.height, `${stage} label wraps`).toBeLessThanOrEqual(lineHeight + 1);
      // A label wider than its column spills into the next one.
      const spill = await label.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(spill, `${stage} label overflows its column`).toBeLessThanOrEqual(0);
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, "horizontal page scroll").toBeLessThanOrEqual(0);
  });
}

test("a funnel bar opens the pipeline filtered to its stage", async ({ page }) => {
  await openRoute(page, home);

  await page.locator('a[data-stage="Passed"]').click();

  await expect(page).toHaveURL(/\/pipeline\?stage=Passed$/);
});

test("home registers its actions in the command palette", async ({ page }) => {
  await openRoute(page, home);

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill("new mandate");
  await expect(palette.getByRole("option").first()).toContainText("New mandate");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/mandate$/);
});

test("home funnel bar opens pipeline filtered to that stage", async ({ page }) => {
  await openRoute(page, home);
  const bar = page.locator('a[data-stage="Qualified"]');
  // The link reads "<count> <stage>": its name is what it shows.
  const funnelCount = Number(/^(\d+)/.exec((await bar.innerText()).trim())?.[1]);
  expect(funnelCount).toBeGreaterThan(0);

  await bar.click();

  await expect(page).toHaveURL(/\/pipeline\?stage=Qualified$/);
  await expect(page.getByRole("radio", { name: /^Qualified/ })).toBeChecked();
  // The page lists exactly the firms the bar counted, all at that stage.
  const rows = page.locator("tr[data-index]");
  await expect(rows).toHaveCount(funnelCount);
  await expect(rows.locator('[data-stage="Qualified"]')).toHaveCount(funnelCount);
  await expect(page.locator("#main header")).toContainText(`${funnelCount} of `);
});

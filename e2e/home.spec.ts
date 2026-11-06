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

for (const width of [1440, 768, 390]) {
  test(`home funnel shows every stage on one line at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openRoute(page, home);

    for (const stage of STAGES) {
      const label = page.locator(`a[data-stage="${stage}"]`).getByText(stage, { exact: true });
      await expect(label, stage).toBeVisible();
      const lineHeight = await label.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
      const box = await label.boundingBox();
      expect(box!.height, `${stage} label wraps`).toBeLessThanOrEqual(lineHeight + 1);
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

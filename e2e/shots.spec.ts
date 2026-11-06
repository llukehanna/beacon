import { test } from "@playwright/test";
import { ROUTES, openRoute } from "./routes";

// Screenshots for comparing the UI with the mockups: `npm run shots`, output in test-results/shots.
const WIDTHS = [1440, 1280, 768, 390];

for (const route of ROUTES) {
  for (const width of WIDTHS) {
    test(`${route.path} at ${width}px @shots`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openRoute(page, route);
      await page.screenshot({
        path: `test-results/shots/${route.slug}-${width}.png`,
        fullPage: true,
      });
    });
  }
}

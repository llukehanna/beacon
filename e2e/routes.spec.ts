import { expect, test } from "@playwright/test";
import { ROUTES, openRoute } from "./routes";

for (const route of ROUTES) {
  test(`${route.path} loads without console errors`, async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        problems.push(`console.error: ${msg.text()}`);
      }
    });
    page.on("pageerror", (err) => problems.push(`uncaught: ${err.message}`));
    page.on("response", (res) => {
      if (new URL(res.url()).pathname.startsWith("/api/") && !res.ok()) {
        problems.push(`${res.status()} ${res.request().method()} ${res.url()}`);
      }
    });

    await openRoute(page, route);

    expect(problems).toEqual([]);
  });
}

const noHorizontalScroll = () => document.documentElement.scrollWidth - window.innerWidth;

for (const route of ROUTES) {
  test(`${route.path} does not scroll sideways at 390px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openRoute(page, route);

    expect(await page.evaluate(noHorizontalScroll)).toBeLessThanOrEqual(0);
  });

  test(`${route.path} has one h1 and one main landmark`, async ({ page }) => {
    await openRoute(page, route);

    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveCount(1);
  });
}

test("the skip link moves focus to the main content", async ({ page }) => {
  await openRoute(page, ROUTES[0]);

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
});

test("Tab reaches the desk's grid without walking the queue", async ({ page }) => {
  const desk = ROUTES.find((r) => r.path === "/desk")!;
  await openRoute(page, desk);
  // Start from the top of the page: nothing focused.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  // The queue holds hundreds of firms; its list is one tab stop (arrow keys move within it), so
  // the sidebar costs a handful of presses (its footer's About and Trust links among them), the
  // header's Tear sheet link is one more, the demo persona picker another, and the first grid
  // row comes right after.
  const MAX_PRESSES = 19;
  let presses = 0;
  while (presses < MAX_PRESSES) {
    await page.keyboard.press("Tab");
    presses += 1;
    const onGridRow = await page.evaluate(() => document.activeElement?.matches("tr[data-axis]"));
    if (onGridRow === true) {
      break;
    }
  }
  await expect(page.locator("tr[data-axis]:focus")).toHaveCount(1);
  expect(presses).toBeLessThanOrEqual(MAX_PRESSES);
});

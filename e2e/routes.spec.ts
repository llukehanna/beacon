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

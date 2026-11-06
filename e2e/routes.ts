import { type Page, expect } from "@playwright/test";

export interface AppRoute {
  /** URL path. */
  path: string;
  /** File-name stem for screenshots. */
  slug: string;
  /** Resolves once the page's main heading is on screen. */
  heading: (page: Page) => ReturnType<Page["locator"]>;
}

// The shell's top bar is also a <header>, so look inside the page area.
const headerText = (text: string) => (page: Page) =>
  page.locator("#main header").getByText(text, { exact: true });

export const ROUTES: AppRoute[] = [
  // The one-sentence headline is Home's title.
  { path: "/", slug: "home", heading: (page) => page.getByRole("heading", { level: 1 }) },
  // The desk titles the page with the selected firm's name.
  { path: "/desk", slug: "desk", heading: (page) => page.getByRole("heading", { level: 1 }) },
  { path: "/pipeline", slug: "pipeline", heading: headerText("Working set") },
  { path: "/review", slug: "review", heading: headerText("Drift queue") },
  { path: "/rules", slug: "rules", heading: headerText("Proposed hard-screen rules") },
  { path: "/accuracy", slug: "accuracy", heading: headerText("Trust metrics") },
  { path: "/mandate", slug: "mandate", heading: headerText("Mandates") },
];

/** Opens a route and waits for its main heading and for the data requests to settle. */
export async function openRoute(page: Page, route: AppRoute): Promise<void> {
  await page.goto(route.path);
  await expect(route.heading(page).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
}

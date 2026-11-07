import { type Page, expect, test } from "@playwright/test";
import { ROUTES, openRoute } from "./routes";

const desk = ROUTES.find((r) => r.path === "/desk")!;
const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

/** Opens the desk on its showcase firm and returns the firm's id and name. */
async function showcaseFirm(page: Page): Promise<{ id: string; name: string }> {
  await openRoute(page, desk);
  await expect(page).toHaveURL(/\/desk\?firmId=/);
  const id = new URL(page.url()).searchParams.get("firmId")!;
  const name = (await desk.heading(page).first().innerText()).trim();
  return { id, name };
}

/** Every object of a type, read through the API the app itself uses. */
async function allObjects<T>(page: Page, type: string): Promise<T[]> {
  const out: T[] = [];
  let token: string | undefined;
  do {
    const res = await page.request.get(
      `/api/objects?type=${type}&pageSize=1000${token === undefined ? "" : `&pageToken=${encodeURIComponent(token)}`}`,
    );
    const body = (await res.json()) as { data: T[]; nextPageToken?: string | null };
    out.push(...body.data);
    token = body.nextPageToken ?? undefined;
  } while (token !== undefined);
  return out;
}

const tearSheetPath = (id: string) => `/firm/${encodeURIComponent(id)}/tear-sheet`;

test("tear sheet renders a showcase firm", async ({ page }) => {
  const { id, name } = await showcaseFirm(page);

  // The Desk header links to it.
  await page.getByRole("link", { name: "Tear sheet" }).click();
  await expect(page).toHaveURL(tearSheetPath(id));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);

  for (const section of [
    "Overview",
    "Score and tier",
    "Key evidence",
    "Open conflicts and abstentions",
    "Decision history",
  ]) {
    await expect(page.getByRole("heading", { level: 2, name: section })).toBeVisible();
  }

  // The score, with its per-axis breakdown.
  const score = page.getByRole("region", { name: "Score and tier" });
  await expect(score).toContainText(/\/ 18/);
  await expect(score.getByRole("table")).toBeVisible();
  await expect(score.getByRole("row")).not.toHaveCount(1);

  // Cited evidence: a quote, its provider and the model that read it.
  const evidence = page.getByRole("region", { name: "Key evidence" });
  await expect(evidence.locator("blockquote").first()).toBeVisible();
  await expect(evidence).toContainText(/Source: .+ · Read by /);

  // The showcase firm has an open conflict and an abstention; both are said in words.
  const open = page.getByRole("region", { name: "Open conflicts and abstentions" });
  await expect(open).toContainText("Sources disagree, not resolved");
  await expect(open).toContainText("No source supported a value, so Beacon did not guess.");
});

test("the tear sheet prints from its button and is named after the firm", async ({ page }) => {
  const { id, name } = await showcaseFirm(page);
  await page.goto(tearSheetPath(id));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  await expect(page).toHaveTitle(`Beacon — Tear sheet: ${name}`);

  await page.evaluate(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => {
      (window as unknown as { printed: number }).printed += 1;
    };
  });
  const button = page.getByRole("button", { name: "Print / Save as PDF" });
  await button.focus();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
});

test("print layout hides the shell", async ({ page }) => {
  const { id, name } = await showcaseFirm(page);
  await page.goto(tearSheetPath(id));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);

  // On screen the shell is there.
  const sidebar = page.getByRole("complementary", { name: "Workspace" });
  await expect(sidebar).toBeVisible();

  await page.emulateMedia({ media: "print" });
  await expect(sidebar).toBeHidden();
  await expect(page.getByRole("contentinfo", { name: "Status" })).toBeHidden();
  await expect(page.locator("#main").locator("xpath=preceding-sibling::header")).toBeHidden();
  await expect(page.getByRole("button", { name: "Print / Save as PDF" })).toBeHidden();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // Black on white, whatever the app theme is.
  const colours = await page.evaluate(() => ({
    page: getComputedStyle(document.body).backgroundColor,
    ink: getComputedStyle(document.querySelector("h1")!).color,
    note: getComputedStyle(document.querySelector("h2")!).color,
  }));
  expect(colours).toEqual({
    page: "rgb(255, 255, 255)",
    ink: "rgb(0, 0, 0)",
    note: "rgb(0, 0, 0)",
  });
  // The page flows rather than scrolling inside a viewport-high box.
  const scrolls = await page.evaluate(() => {
    const main = document.getElementById("main")!;
    return getComputedStyle(main).overflowY;
  });
  expect(scrolls).toBe("visible");

  // Going back to screen restores the shell.
  await page.emulateMedia({ media: "screen" });
  await expect(sidebar).toBeVisible();
});

test("the tear sheet keeps to 390 px, with one h1 and a quiet console", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      problems.push(msg.text());
    }
  });
  page.on("pageerror", (err) => problems.push(err.message));
  const { id, name } = await showcaseFirm(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(tearSheetPath(id));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  await page.waitForLoadState("networkidle");

  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.getByRole("main")).toHaveCount(1);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  expect(problems).toEqual([]);
});

test("an unknown firm says so", async ({ page }) => {
  await page.goto(tearSheetPath("no-such-firm"));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Firm not found");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.getByText("No firm has this id.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Print / Save as PDF" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Open the Pipeline" })).toBeVisible();
});

// The same firm for every persona: one the analyst can see is visible to the others too.
for (const persona of ["analyst", "deal_lead", "compliance"]) {
  test(`a firm nobody has researched says so instead of reporting a clean bill, as ${persona}`, async ({
    page,
  }) => {
    const firms = await allObjects<{ firmId: string; firmName: string }>(page, "Firm");
    const findings = await allObjects<{ firmId: string }>(page, "ResearchFinding");
    const researched = new Set(findings.map((f) => f.firmId));
    const bare = firms.find((f) => !researched.has(f.firmId));
    expect(bare).toBeDefined();

    await page.addInitScript((p) => window.localStorage.setItem("beacon.persona", p), persona);
    await page.goto(tearSheetPath(bare!.firmId));
    await expect(page.getByLabel("Viewing as")).toHaveValue(persona);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(bare!.firmName);
    const evidence = page.getByRole("region", { name: "Key evidence" });
    await expect(evidence).toContainText("No research has run on this firm yet");
    const open = page.getByRole("region", { name: "Open conflicts and abstentions" });
    await expect(open).toContainText("No research has run on this firm yet");
    await expect(open).not.toContainText("No open conflicts");
    // Nothing is cited, so the page does not claim its quotes were checked.
    await expect(page.getByText("found verbatim")).toHaveCount(0);
  });
}

test("tear sheet shows a retry on load failure", async ({ page }) => {
  const { id, name } = await showcaseFirm(page);

  // The firm cannot be loaded (the app retries once, so every request fails until it is healed).
  let failing = true;
  await page.route(
    (url) => url.pathname === "/api/objects" && url.searchParams.get("type") === "Firm",
    (route) =>
      failing
        ? route.fulfill({ status: 500, json: { error: "Internal error" } })
        : route.continue(),
  );
  await page.goto(tearSheetPath(id));

  const notice = page.getByRole("alert").filter({ hasText: "load this firm’s tear sheet" });
  await expect(notice).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tear sheet");
  await expect(page.getByRole("button", { name: "Print / Save as PDF" })).toBeDisabled();

  failing = false;
  await notice.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  await expect(notice).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Score and tier" })).toBeVisible();
});

test("a passed firm shows the score it was passed at beside the live score", async ({ page }) => {
  const firms = await allObjects<{ firmId: string; firmName: string; lifecycleState?: string }>(
    page,
    "Firm",
  );
  const decisions = await allObjects<{
    firmId: string;
    decisionType?: string;
    scoreAtDecision?: number;
  }>(page, "ReviewDecision");
  const passed = new Set(firms.filter((f) => f.lifecycleState === "Passed").map((f) => f.firmId));
  const rejection = decisions.find(
    (d) =>
      passed.has(d.firmId) &&
      (d.decisionType ?? "").includes("reject") &&
      typeof d.scoreAtDecision === "number",
  );
  expect(rejection).toBeDefined();

  await page.goto(tearSheetPath(rejection!.firmId));
  const score = page.getByRole("region", { name: "Score and tier" });
  await expect(score).toContainText(`Score when passed: ${rejection!.scoreAtDecision}/18`);
  await expect(score).toContainText("The score above is the live one.");
  await expect(page.getByText(/^Passed · /)).toBeVisible();
  // The decision that passed it is in the history, with its reason.
  await expect(page.getByRole("region", { name: "Decision history" })).toContainText("Passed");
});

test("the command palette opens the open firm's tear sheet", async ({ page }) => {
  const { id, name } = await showcaseFirm(page);

  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await page.keyboard.type("Tear sheet");
  await expect(
    page.getByRole("dialog", { name: "Command palette" }).getByRole("option").first(),
  ).toContainText(`Tear sheet: ${name}`);
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(tearSheetPath(id));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
});

test("the pipeline detail links to a passed firm's tear sheet", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/pipeline?stage=Passed");
  // The list is sorted once every firm has arrived; read the first row after that.
  await page.waitForLoadState("networkidle");
  const row = page.locator("tr[data-index]").first();
  const name = (await row.locator("td").first().innerText()).split("\n")[0];
  await row.click();

  await page
    .getByRole("complementary", { name: "Firm detail" })
    .getByRole("link", { name: "Tear sheet" })
    .click();

  await expect(page).toHaveURL(/\/firm\/.+\/tear-sheet$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  await expect(page.getByRole("region", { name: "Score and tier" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Decision history" })).toBeVisible();
});

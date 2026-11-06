import { type Page, expect, test } from "@playwright/test";

// The desk tests share one database and run in file order. Resolving and verifying commit the
// firm, which closes its agent run, so each test lands on the next showcase firm. The test that
// passes on a firm is last, and no other test depends on its effect.
test.describe.configure({ mode: "serial" });

interface FindingCounts {
  conflicts: number;
  proposed: number;
  abstained: number;
  verified: number;
}

const SUMMARY = /(\d+) conflicts? · (\d+) proposed · (\d+) abstained · (\d+) verified/;

async function findingCounts(page: Page): Promise<FindingCounts> {
  const text = await page.getByText(SUMMARY).innerText();
  const [, conflicts, proposed, abstained, verified] = SUMMARY.exec(text) ?? [];
  return {
    conflicts: Number(conflicts),
    proposed: Number(proposed),
    abstained: Number(abstained),
    verified: Number(verified),
  };
}

/** Opens the desk with no firm in the URL and waits for it to land on one with findings. */
async function openDesk(page: Page): Promise<void> {
  await page.goto("/desk");
  await expect(page).toHaveURL(/\/desk\?firmId=/);
  await expect(page.getByText(SUMMARY)).toBeVisible();
}

const commitEnrichment = (page: Page) => page.getByRole("button", { name: /Commit enrichment/ });
/** The first grid row in a state ("conflict", "proposed", ...); selecting it fills the evidence panel. */
const gridRow = (page: Page, state: string) => page.locator(`tr[data-state="${state}"]`).first();
const evidence = (page: Page) => page.getByRole("complementary", { name: "Evidence" });

test("desk opens on the showcase firm", async ({ page }) => {
  await openDesk(page);

  const counts = await findingCounts(page);
  expect(counts.conflicts).toBeGreaterThanOrEqual(1);
  expect(counts.proposed).toBeGreaterThanOrEqual(1);
  await expect(page.getByText("Conflict", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Proposed", { exact: true }).first()).toBeVisible();
});

test("evidence panel shows grounding checks", async ({ page }) => {
  await openDesk(page);

  // A proposed axis cites a source: its panel lists the three checks the quote passed.
  await gridRow(page, "proposed").click();
  const checks = evidence(page).getByRole("list", { name: "Grounding checks" });
  await expect(checks.getByRole("listitem")).toHaveCount(3);
  await expect(checks).toContainText("Quote found verbatim in source");
  await expect(checks).toContainText("Value appears in the quote");
  await expect(checks).toContainText("Quote long enough to stand alone");
  await expect(evidence(page).getByRole("button", { name: /^Verify / })).toBeVisible();
});

test("a click on the grid's first paint is not overridden by the opening selection", async ({
  page,
}) => {
  // The desk opens on the first axis that needs a decision, from an effect that runs just after
  // the grid renders. Click a proposed row in the very task that paints it, ahead of that effect,
  // the way a fast or slow-to-schedule click lands.
  await page.addInitScript(() => {
    const w = window as unknown as { clickedAxis?: string };
    const watch = new MutationObserver(() => {
      const row = document.querySelector<HTMLElement>('tr[data-state="proposed"]');
      if (row !== null && w.clickedAxis === undefined) {
        w.clickedAxis = row.dataset.axis;
        row.click();
        watch.disconnect();
      }
    });
    watch.observe(document, { childList: true, subtree: true });
  });
  await openDesk(page);

  const clicked = await page.evaluate(
    () => (window as unknown as { clickedAxis?: string }).clickedAxis,
  );
  expect(clicked).toBeDefined();
  await expect(page.locator(`tr[data-axis="${clicked}"]`)).toHaveAttribute("aria-current", "true");
  await expect(evidence(page).getByRole("button", { name: /^Verify / })).toBeVisible();
});

test("rejecting a proposed value stages the analyst's own", async ({ page }) => {
  await openDesk(page);
  await expect(page.getByText(/^pending: /)).toHaveCount(0);

  await gridRow(page, "proposed").click();
  await evidence(page)
    .getByRole("button", { name: /^Reject/ })
    .click();
  const editor = evidence(page).getByRole("region", { name: "Your value" });
  await expect(editor).toContainText("and use your own");
  // Categorical axes offer the rubric's options; numeric ones a number field.
  const options = editor.getByRole("radio");
  if ((await options.count()) > 0) {
    await options.last().click();
  } else {
    await editor.getByRole("spinbutton").fill("7");
    await editor.getByRole("button", { name: "Reject and use value" }).click();
  }

  await expect(page.getByText(/^pending: /)).toBeVisible();
  await expect(commitEnrichment(page)).toBeEnabled();
});

test("the evidence panel is a drawer under 1280px", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await openDesk(page);
  await expect(evidence(page)).toHaveCount(0);

  await gridRow(page, "proposed").click();
  const drawer = page.locator(".bp6-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { name: /^Verify / })).toBeVisible();
  await expect(drawer.getByRole("list", { name: "Grounding checks" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});

test("desk renders a never-enriched firm", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      problems.push(`console.error: ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => problems.push(`uncaught: ${err.message}`));

  await openDesk(page);
  // The queue's state line says which firms the agent has not run on yet.
  await page
    .getByRole("list", { name: "Firms in the queue" })
    .getByRole("button")
    .filter({ hasText: "Not yet enriched" })
    .first()
    .click();

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("No agent run yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run agent" })).toBeVisible();
  // The rubric axes are still listed, and each one can be answered by hand.
  await expect(page.getByText("No findings yet.")).toBeVisible();
  await expect(page.locator('tr[data-state="empty"]').first()).toBeVisible();
  // No provider readings are shown for a run that has not happened.
  await expect(
    page.locator('tr[data-axis="services_fit"] [role="img"][aria-label*="confidence"]'),
  ).toHaveCount(0);
  await page.locator('tr[data-axis="services_fit"]').click();
  await expect(evidence(page).getByRole("radio").first()).toBeVisible();
  await page.locator('tr[data-axis="firm_age"]').click();
  await expect(evidence(page).getByRole("spinbutton", { name: /value$/ })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(problems).toEqual([]);
});

test("the queue's search and show-all survive the sidebar drawer at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDesk(page);
  const drawer = page.locator(".bp6-drawer");
  const open = async (): Promise<void> => {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(drawer).toBeVisible();
  };

  await open();
  const search = drawer.getByRole("textbox", { name: "Search firms" });
  await search.fill("advis");
  const showAll = drawer.getByRole("checkbox", { name: "Show all firms" });
  await showAll.check();
  await expect(drawer.getByText(/matching · searching all firms/)).toBeVisible();

  // Closing and reopening the drawer remounts the queue; what was typed and ticked stays.
  await drawer.getByRole("button", { name: "Close" }).click();
  await expect(drawer).toBeHidden();
  await open();
  await expect(drawer.getByRole("textbox", { name: "Search firms" })).toHaveValue("advis");
  await expect(drawer.getByRole("checkbox", { name: "Show all firms" })).toBeChecked();

  // Widening the window swaps the drawer for the fixed rail; the same two settings are there.
  await drawer.getByRole("button", { name: "Close" }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  const rail = page.getByRole("complementary", { name: "Workspace" });
  await expect(rail.getByRole("textbox", { name: "Search firms" })).toHaveValue("advis");
  await expect(rail.getByRole("checkbox", { name: "Show all firms" })).toBeChecked();
});

test("view a source", async ({ page }) => {
  await openDesk(page);

  await gridRow(page, "proposed").click();

  // The source document opens in the evidence panel with the cited passage marked.
  await expect(evidence(page).getByRole("figure", { name: "Source document" })).toBeVisible();
  const quote = evidence(page).locator("mark");
  await expect(quote).toBeVisible();
  expect((await quote.innerText()).trim().length).toBeGreaterThan(0);
  // The checks confirm that passage is in the document.
  await expect(
    evidence(page).getByRole("listitem").filter({ hasText: "Quote found verbatim in source" }),
  ).toHaveAttribute("data-status", "pass");
});

test("typing in the note does not trigger shortcuts", async ({ page }) => {
  await openDesk(page);
  // Select a proposed axis: V would verify it and R would open its reject editor if a key leaked.
  const row = gridRow(page, "proposed");
  await row.click();
  const axis = await row.getAttribute("data-axis");
  const axisRow = page.locator(`tr[data-axis="${axis}"]`);
  await expect(axisRow).toHaveAttribute("aria-current", "true");
  const stage = await page.getByTitle("Lifecycle stage").innerText();
  const before = await findingCounts(page);

  const note = page.getByRole("textbox", { name: "Decision note" });
  await note.click();
  await page.keyboard.type("Ready to verify");

  await expect(note).toHaveValue("Ready to verify");
  await expect(axisRow).toHaveAttribute("data-state", "proposed");
  expect(await findingCounts(page)).toEqual(before);
  await expect(page.getByTitle("Lifecycle stage")).toHaveText(stage);
  await expect(evidence(page).getByRole("region", { name: "Your value" })).not.toContainText(
    "and use your own",
  );
  await expect(page.getByText(/^pending: /)).toHaveCount(0);
  await expect(commitEnrichment(page)).toBeDisabled();
});

test("desk shortcuts work", async ({ page }) => {
  await openDesk(page);
  const before = await findingCounts(page);

  // Focus the grid on a proposed axis and press V.
  const row = gridRow(page, "proposed");
  const axis = await row.getAttribute("data-axis");
  await row.click();
  await expect(row).toBeFocused();
  await page.keyboard.press("v");

  const verified = page.locator(`tr[data-axis="${axis}"]`);
  await expect(verified).toHaveAttribute("data-state", "verified");
  await expect(page.getByText(SUMMARY)).toContainText(
    `${before.proposed - 1} proposed · ${before.abstained} abstained · ${before.verified + 1} verified`,
  );
  await expect(commitEnrichment(page)).toBeEnabled();

  // Shift+R is the firm-level Pass; with no note it asks for one instead of passing.
  await page.keyboard.press("Shift+R");
  await expect(
    page.getByRole("alert").filter({ hasText: "A note is required to pass." }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Decision note" })).toBeFocused();
});

test("resolve a conflict", async ({ page }) => {
  await openDesk(page);
  expect((await findingCounts(page)).conflicts).toBeGreaterThanOrEqual(1);
  await expect(page.getByText(/^pending: /)).toHaveCount(0);

  // Each side of the conflict has an Accept button in the evidence panel.
  await gridRow(page, "conflict").click();
  const resolved = page.waitForResponse(
    (res) =>
      res.url().endsWith("/api/actions") &&
      res.request().postData()?.includes("resolveConflict") === true,
  );
  await evidence(page)
    .getByRole("button", { name: /^Accept / })
    .first()
    .click();
  expect((await resolved).status()).toBe(200);

  // The chosen value is staged on its axis until the analyst commits.
  await expect(page.getByText(/^pending: /)).toBeVisible();
  await expect(page.getByText(/Resolve failed/)).toHaveCount(0);
  await expect(commitEnrichment(page)).toBeEnabled();

  await commitEnrichment(page).click();
  await expect(page.getByText(/^pending: /)).toHaveCount(0);
  await expect(commitEnrichment(page)).toBeDisabled();
});

test("verify a proposed value", async ({ page }) => {
  await openDesk(page);
  const before = await findingCounts(page);
  expect(before.proposed).toBeGreaterThanOrEqual(1);

  await gridRow(page, "proposed").click();
  await evidence(page)
    .getByRole("button", { name: /^Verify / })
    .click();
  await expect(commitEnrichment(page)).toBeEnabled();
  await expect(page.getByText(SUMMARY)).toContainText(
    `${before.proposed - 1} proposed · ${before.abstained} abstained · ${before.verified + 1} verified`,
  );

  const verified = page.waitForResponse(
    (res) =>
      res.url().endsWith("/api/actions") &&
      res.request().postData()?.includes("verifyFinding") === true,
  );
  await commitEnrichment(page).click();
  expect((await verified).status()).toBe(200);
  await expect(commitEnrichment(page)).toBeDisabled();

  // The verification is stored, not just staged: it is still there after a reload.
  await page.reload();
  await expect(page.getByText(SUMMARY)).toContainText(
    `${before.proposed - 1} proposed · ${before.abstained} abstained · ${before.verified + 1} verified`,
  );
});

test("reject requires a note", async ({ page }) => {
  await openDesk(page);
  const queueCount = async (): Promise<number> => {
    const text = await page.getByText(/\d+ in live queue/).innerText();
    return Number(/(\d+) in live queue/.exec(text)?.[1]);
  };
  const before = await queueCount();
  const pass = page.getByRole("button", { name: /^Pass…/ });

  // Without a note, passing is blocked and the firm stays in the queue.
  await pass.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "A note is required to pass." }),
  ).toBeVisible();
  expect(await queueCount()).toBe(before);

  const rejected = page.waitForResponse(
    (res) =>
      res.url().endsWith("/api/actions") &&
      res.request().postData()?.includes("rejectFirm") === true,
  );
  await page.getByPlaceholder(/required to pass/).fill("Outside the mandate");
  await pass.click();
  expect((await rejected).status()).toBe(200);

  // With a note it goes through, and the firm leaves the open queue.
  await expect(page.getByText(`${before - 1} in live queue`)).toBeVisible();
});

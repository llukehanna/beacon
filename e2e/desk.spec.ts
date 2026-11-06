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
const proposedCard = (page: Page) =>
  page
    .getByTestId("finding-card")
    .filter({ has: page.getByRole("button", { name: "Verify", exact: true }) });

test("desk opens on the showcase firm", async ({ page }) => {
  await openDesk(page);

  const counts = await findingCounts(page);
  expect(counts.conflicts).toBeGreaterThanOrEqual(1);
  expect(counts.proposed).toBeGreaterThanOrEqual(1);
  await expect(page.getByText("Conflict", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Proposed", { exact: true }).first()).toBeVisible();
});

test("view a source", async ({ page }) => {
  await openDesk(page);

  const card = proposedCard(page).first();
  await card.getByRole("button", { name: "View source" }).click();

  await expect(page.getByRole("heading", { name: "Source document" })).toBeVisible();
  const quote = page.locator("mark");
  await expect(quote).toBeVisible();
  const cited = (await quote.innerText()).trim();
  expect(cited.length).toBeGreaterThan(0);
  // The highlighted passage is the quote the card cites.
  await expect(card).toContainText(cited);
});

test("resolve a conflict", async ({ page }) => {
  await openDesk(page);
  expect((await findingCounts(page)).conflicts).toBeGreaterThanOrEqual(1);
  await expect(page.getByText(/^pending: /)).toHaveCount(0);

  // Each side of the conflict is a button: "<source> <value> Accept <source> →".
  const resolved = page.waitForResponse(
    (res) =>
      res.url().endsWith("/api/actions") &&
      res.request().postData()?.includes("resolveConflict") === true,
  );
  await page
    .getByRole("button", { name: /Accept \S.* →/ })
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

  await proposedCard(page).first().getByRole("button", { name: "Verify", exact: true }).click();
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

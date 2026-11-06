import { type Page, expect, test } from "@playwright/test";
import { ROUTES, openRoute } from "./routes";

const review = ROUTES.find((r) => r.path === "/review")!;
const LABEL = "Synthetic market signal";

interface Signal {
  signalId: string;
  firmId: string;
  kind: string;
  headline: string;
  appliedAt?: string;
}

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

test("the Review page lists recent applied signals, each labelled synthetic", async ({ page }) => {
  await openRoute(page, review);
  const section = page.getByRole("region", { name: "Signals" });
  await expect(section).toBeVisible();
  await expect(section).toContainText("Synthetic market signals are invented news");

  const rows = section.locator("li[data-signal]");
  const shown = await rows.count();
  expect(shown).toBeGreaterThan(3);
  for (let i = 0; i < shown; i++) {
    const row = rows.nth(i);
    await expect(row).toContainText(LABEL);
    await expect(row.getByRole("link")).toBeVisible();
  }

  // The rows are the applied signals, newest first; the ones still to come are not listed.
  const signals = await allObjects<Signal>(page, "MarketSignal");
  const applied = signals.filter((s) => s.appliedAt !== undefined);
  const waiting = signals.filter((s) => s.appliedAt === undefined);
  expect(waiting.length, "the seed leaves a few for the hourly run").toBeGreaterThan(0);
  await expect(section.getByText(waiting[0].headline)).toHaveCount(0);
  expect(applied.length).toBeGreaterThanOrEqual(shown);
});

test("a signal that moved a decided firm has put it in the drift queue", async ({ page }) => {
  const [signals, drifts] = await Promise.all([
    allObjects<Signal>(page, "MarketSignal"),
    allObjects<{ firmId: string; driftReason: string; changedAxes?: string; driftStatus: string }>(
      page,
      "DriftEvent",
    ),
  ]);
  const bySignal = drifts.filter(
    (d) => d.driftStatus === "open" && (d.changedAxes ?? "").includes(LABEL),
  );
  expect(bySignal.length).toBeGreaterThan(0);
  expect(signals.some((s) => s.firmId === bySignal[0].firmId && s.appliedAt !== undefined)).toBe(
    true,
  );

  await openRoute(page, review);
  await page.setViewportSize({ width: 1440, height: 900 });
  // The drift detail names the synthetic signal as the source of the change.
  const rows = page.locator("button[data-drift]:not([data-resolved])");
  const count = await rows.count();
  let seen = false;
  for (let i = 0; i < count && !seen; i++) {
    await rows.nth(i).click();
    seen =
      (await page.getByRole("region", { name: "What changed" }).count()) > 0 &&
      (await page.getByRole("region", { name: "What changed" }).innerText()).includes(LABEL);
  }
  expect(seen, "an open drift event whose change came from a synthetic signal").toBe(true);
});

test("the tear sheet lists a firm's market signals, labelled", async ({ page }) => {
  await page.goto("/");
  const signals = await allObjects<Signal>(page, "MarketSignal");
  const applied = signals.find((s) => s.appliedAt !== undefined)!;
  await page.goto(`/firm/${encodeURIComponent(applied.firmId)}/tear-sheet`);
  const section = page.getByRole("region", { name: "Market signals" });
  await expect(section).toBeVisible();
  await expect(section).toContainText(applied.headline);
  await expect(section).toContainText(LABEL);
  await expect(section).toContainText("invented news");
});

test("a firm with no applied signal says so on its tear sheet", async ({ page }) => {
  await page.goto("/");
  const signals = await allObjects<Signal>(page, "MarketSignal");
  const withSignal = new Set(signals.filter((s) => s.appliedAt !== undefined).map((s) => s.firmId));
  const firms = await allObjects<{ firmId: string }>(page, "Firm");
  const bare = firms.find((f) => !withSignal.has(f.firmId))!;
  await page.goto(`/firm/${encodeURIComponent(bare.firmId)}/tear-sheet`);
  const section = page.getByRole("region", { name: "Market signals" });
  await expect(section).toContainText("No market signal has been applied to this firm yet.");
});

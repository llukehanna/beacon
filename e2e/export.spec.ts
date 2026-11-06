import { type Page, expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { readFileSync } from "node:fs";
import { ROUTES, openRoute } from "./routes";

const pipeline = ROUTES.find((r) => r.path === "/pipeline")!;
const mandate = ROUTES.find((r) => r.path === "/mandate")!;

const exportMenu = (page: Page) => page.getByRole("button", { name: "Export" }).first();

/** Opens the Export menu, picks an item and returns the download it starts. */
async function download(page: Page, item: string) {
  await exportMenu(page).click();
  const started = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: item }).click();
  return started;
}

const entities = (s: string): string =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

/** The first row of a sheet's cells as text, read straight from the workbook's XML. */
function headerRow(files: Record<string, Uint8Array>, sheetFile: string): string[] {
  const shared = files["xl/sharedStrings.xml"];
  const strings =
    shared === undefined
      ? []
      : [...strFromU8(shared).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
          entities([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")),
        );
  const xml = strFromU8(files[sheetFile]);
  const first = xml.match(/<row[^>]*>([\s\S]*?)<\/row>/)![1];
  return [...first.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
    const body = c[2] ?? "";
    const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
    const inline = body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
    return entities(
      /t="s"/.test(c[1]) && v !== undefined ? strings[Number(v)] : (inline ?? v ?? ""),
    );
  });
}

test("export downloads a workbook", async ({ page }) => {
  await openRoute(page, pipeline);
  const dl = await download(page, "Excel workbook");
  expect(dl.suggestedFilename()).toMatch(/^beacon-pipeline-\d{4}-\d{2}-\d{2}\.xlsx$/);

  const path = await dl.path();
  const bytes = readFileSync(path);
  expect(bytes.length).toBeGreaterThan(0);

  const files = unzipSync(new Uint8Array(bytes));
  const workbook = strFromU8(files["xl/workbook.xml"]);
  expect(workbook).toContain('name="Targets"');
  expect(workbook).toContain('name="Citations"');

  const header = headerRow(files, "xl/worksheets/sheet1.xml");
  expect(header).toEqual(expect.arrayContaining(["Tier", "Score"]));
  expect(headerRow(files, "xl/worksheets/sheet2.xml")).toEqual([
    "Firm",
    "Axis",
    "Provider",
    "Quote",
    "Model",
  ]);
  // Frozen header row and first columns.
  expect(strFromU8(files["xl/worksheets/sheet1.xml"])).toMatch(/<pane [^>]*state="frozen"/);
});

test("export downloads a CSV in each CRM's columns", async ({ page }) => {
  await openRoute(page, pipeline);
  const dl = await download(page, "CSV for Salesforce");
  expect(dl.suggestedFilename()).toMatch(/^beacon-pipeline-salesforce-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = readFileSync(await dl.path(), "utf8");
  expect(csv.startsWith("﻿Account Name,Billing Country,")).toBe(true);
  expect(csv.split("\r\n").length).toBeGreaterThan(2);
  expect(csv).not.toContain("undefined");
});

test("the pipeline export follows the filter", async ({ page }) => {
  await openRoute(page, pipeline);
  await page.getByRole("textbox", { name: "Search firms" }).fill("zzqx-no-such-firm");
  await expect(exportMenu(page)).toBeDisabled();
});

test("the export menu works from the keyboard", async ({ page }) => {
  await openRoute(page, pipeline);
  await exportMenu(page).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Excel workbook" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "CSV for Salesforce" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(exportMenu(page)).toBeFocused();
});

test("mandate cards offer an export and the page keeps to 390 px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRoute(page, mandate);
  await expect(exportMenu(page)).toBeEnabled();
  await exportMenu(page).click();
  await expect(page.getByRole("menuitem", { name: "Excel workbook" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("the pipeline keeps to 390 px with the export menu open", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRoute(page, pipeline);
  await exportMenu(page).click();
  await expect(page.getByRole("menuitem", { name: "Excel workbook" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("a search's results on the desk export as a workbook", async ({ page }) => {
  const res = await page.request.get("/api/objects?type=Search");
  const searches = ((await res.json()) as { data: { searchId: string; resultCount?: number }[] })
    .data;
  const withFirms = searches.find((s) => (s.resultCount ?? 0) > 0) ?? searches[0];
  expect(withFirms).toBeDefined();

  await page.goto(`/desk?search=${encodeURIComponent(withFirms.searchId)}`);
  await expect(page.getByText(/\d+ firms?$/).first()).toBeVisible();
  const dl = await download(page, "Excel workbook");
  expect(dl.suggestedFilename()).toMatch(/^beacon-.+\.xlsx$/);
  const files = unzipSync(new Uint8Array(readFileSync(await dl.path())));
  expect(headerRow(files, "xl/worksheets/sheet1.xml")).toEqual(
    expect.arrayContaining(["Tier", "Score"]),
  );
});

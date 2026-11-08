import { type Page, chromium } from "@playwright/test";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

// Records the golden path (Home, Desk on the showcase firm, the conflict, its evidence, Rules,
// Review) against a local server on a fresh seeded PGlite database, then converts the clip with
// ffmpeg. Nothing here touches the hosted site or the e2e database.
//
//   npm run media:record      writes docs/media/golden-path.mp4 and docs/media/golden-path.gif
//
// Needs ffmpeg on the PATH. Set RECORD_SCRATCH to keep the raw capture somewhere specific.

const PORT = 8091;
const BASE = `http://localhost:${PORT}`;
const PGLITE_DIR = ".data/record-pglite";
const OUT_DIR = "docs/media";
const SCRATCH = process.env.RECORD_SCRATCH ?? ".data/record-media";
const VIEWPORT = { width: 1440, height: 900 };

// An empty DATABASE_URL keeps both the seed and the server on local PGlite.
const env = { ...process.env, PGLITE_DIR, DATABASE_URL: "" };

/** A dot that follows the pointer, because a page recording does not draw the mouse. */
const POINTER = `
  window.addEventListener("DOMContentLoaded", () => {
    const dot = document.createElement("div");
    dot.setAttribute("aria-hidden", "true");
    dot.style.cssText =
      "position:fixed;z-index:2147483647;width:18px;height:18px;margin:-9px 0 0 -9px;" +
      "border-radius:50%;background:rgba(40,40,40,0.35);border:2px solid #fff;" +
      "box-shadow:0 0 0 1px rgba(0,0,0,0.5);pointer-events:none;left:-40px;top:-40px;";
    document.documentElement.appendChild(dot);
    window.addEventListener("mousemove", (e) => {
      dot.style.left = e.clientX + "px";
      dot.style.top = e.clientY + "px";
    }, true);
  });
`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(BASE)).ok) {
        return;
      }
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error(`no server on ${BASE}`);
}

/** Moves the pointer to the middle of an element in a few steps, then clicks it. */
async function glideClick(page: Page, selector: string): Promise<void> {
  const target = page.locator(selector).first();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box === null) {
    throw new Error(`${selector} has no box`);
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
  await sleep(250);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function main(): Promise<void> {
  rmSync(PGLITE_DIR, { recursive: true, force: true });
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(SCRATCH, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });

  execFileSync("npm", ["run", "seed"], { stdio: "inherit", env });

  const server: ChildProcess = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
    env,
    stdio: "ignore",
  });
  try {
    await waitForServer();

    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      recordVideo: { dir: SCRATCH, size: VIEWPORT },
    });
    await context.addInitScript(POINTER);
    const page = await context.newPage();
    const startedAt = Date.now();

    // Home. The recording is trimmed to start once the page has painted.
    await page.goto(`${BASE}/`);
    await page.getByRole("heading", { level: 1 }).waitFor();
    await page.waitForLoadState("networkidle");
    const trimStart = (Date.now() - startedAt) / 1000;
    await page.mouse.move(700, 450);
    await sleep(2500);

    // The desk, then the tour's firm found through the queue's search.
    await glideClick(page, 'a[href="/desk"]');
    await page.waitForURL(/\/desk\?firmId=/);
    await page.locator("tr[data-state]").first().waitFor();
    await page.waitForLoadState("networkidle");
    await sleep(800);
    await glideClick(page, 'input[aria-label="Search firms"]');
    await page.keyboard.type("Mallowick", { delay: 90 });
    await sleep(500);
    await glideClick(page, 'button[data-row="mallowickpartners_unitedstates"]');
    await page.waitForURL(/firmId=mallowickpartners_unitedstates/);
    await page.locator('tr[data-state="conflict"]').first().waitFor();
    await page.waitForLoadState("networkidle");
    await sleep(2000);

    // The conflict row, and the evidence panel it opens.
    await glideClick(page, 'tr[data-state="conflict"]');
    await page.getByRole("complementary", { name: "Evidence" }).waitFor();
    await sleep(3500);

    // A proposed value: its quote is highlighted in the source and the checks sit beside it.
    await glideClick(page, 'tr[data-state="proposed"]');
    await page.getByRole("complementary", { name: "Evidence" }).locator("mark").waitFor();
    await sleep(2500);

    // Rules.
    await glideClick(page, 'a[href="/rules"]');
    await page.locator('[data-tour="proposed-rule"]').first().waitFor();
    await page.waitForLoadState("networkidle");
    await sleep(2500);

    // Review.
    await glideClick(page, 'a[href="/review"]');
    await page.locator('[data-tour="drift-list"]').first().waitFor();
    await page.waitForLoadState("networkidle");
    await sleep(2500);

    await context.close();
    await browser.close();

    const webm = readdirSync(SCRATCH).find((f) => f.endsWith(".webm"));
    if (webm === undefined) {
      throw new Error("no recording was written");
    }
    const raw = path.join(SCRATCH, "golden-path.webm");
    renameSync(path.join(SCRATCH, webm), raw);
    convert(raw, trimStart);
  } finally {
    server.kill("SIGTERM");
  }
}

/** Trims the blank lead-in, then writes an H.264 clip and a palette-optimised GIF. */
function convert(raw: string, trimStart: number): void {
  const start = Math.max(0, trimStart - 0.15).toFixed(2);
  const mp4 = path.join(OUT_DIR, "golden-path.mp4");
  const gif = path.join(OUT_DIR, "golden-path.gif");
  const ffmpeg = (args: string[]) =>
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });

  ffmpeg([
    "-ss",
    start,
    "-i",
    raw,
    "-vf",
    "fps=24,format=yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "30",
    "-movflags",
    "+faststart",
    "-an",
    mp4,
  ]);
  ffmpeg([
    "-ss",
    start,
    "-i",
    raw,
    "-vf",
    "fps=8,scale=900:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=80:stats_mode=diff[p];" +
      "[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
    "-loop",
    "0",
    gif,
  ]);
}

await main();

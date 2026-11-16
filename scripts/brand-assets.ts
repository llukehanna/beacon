// Renders Beacon's icons and social cards from one mark, so the favicon, the home-screen icons,
// the link preview and the sidebar logo agree. Output is committed; rerun after changing the mark
// or the card copy:
//
//   npx tsx scripts/brand-assets.ts
//
// Uses the Playwright Chromium the e2e suite already installs (`npx playwright install chromium`).
import { type Page, chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PUBLIC = path.join(ROOT, "public");

/**
 * The mark: an indigo tile with a dark lens ringed in white, matching `.logo` in Sidebar.module.css.
 * `bleed` drops the rounded corners for platforms that apply their own mask (iOS, Android maskable);
 * `lens` is the ring's radius as a share of the tile, smaller when a mask may crop the edges.
 */
function markSvg({ bleed = false, lens = 0.195 }: { bleed?: boolean; lens?: number } = {}): string {
  const rx = bleed ? 0 : 8;
  const r = (32 * lens).toFixed(2);
  const stroke = (32 * lens * 0.4).toFixed(2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <defs>
    <linearGradient id="g" x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="#a3abff"/>
      <stop offset="0.5" stop-color="#5b66f0"/>
      <stop offset="1" stop-color="#2c3399"/>
    </linearGradient>
    <linearGradient id="h" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.35"/>
      <stop offset="0.12" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="32" height="32" rx="${rx}" fill="url(#g)"/>
  <rect width="32" height="32" rx="${rx}" fill="url(#h)"/>
  <circle cx="16" cy="16" r="${r}" fill="#0b0c1c" stroke="#fff" stroke-opacity="0.8" stroke-width="${stroke}"/>
</svg>
`;
}

async function renderSvg(page: Page, svg: string, size: number): Promise<Buffer> {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  return page.screenshot({ omitBackground: true, type: "png" });
}

/** A .ico whose entries are PNGs (supported by every browser that still asks for /favicon.ico). */
function ico(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

function dataUrl(file: string, type: string): string {
  return `data:${type};base64,${readFileSync(file).toString("base64")}`;
}

/** The link preview: the mark, one sentence on what Beacon does, and the desk behind it. */
function cardHtml(width: number, height: number): string {
  const font = (name: string): string =>
    dataUrl(
      path.join(
        ROOT,
        "node_modules",
        "@fontsource-variable",
        name,
        "files",
        `${name}-latin-wght-normal.woff2`,
      ),
      "font/woff2",
    );
  const shot = dataUrl(path.join(ROOT, "docs", "screenshots", "desk.png"), "image/png");
  return `<!doctype html><html><head><style>
  @font-face { font-family: Geist; src: url(${font("geist")}) format("woff2"); font-weight: 100 900; }
  @font-face { font-family: GeistMono; src: url(${font("geist-mono")}) format("woff2"); font-weight: 100 900; }
  * { box-sizing: border-box; margin: 0; }
  body {
    width: ${width}px; height: ${height}px; overflow: hidden; position: relative;
    font-family: Geist, sans-serif; color: #ecedef; -webkit-font-smoothing: antialiased;
    background:
      radial-gradient(900px 480px at 20% -20%, rgba(110, 123, 255, 0.22), transparent 60%),
      radial-gradient(700px 400px at 110% 110%, rgba(79, 209, 154, 0.07), transparent 60%),
      #07080a;
  }
  .copy { position: absolute; left: 72px; top: 0; bottom: 0; width: 540px; display: flex; flex-direction: column; justify-content: center; gap: 28px; }
  .brand { display: flex; align-items: center; gap: 16px; font-size: 34px; font-weight: 600; letter-spacing: -0.02em; }
  .brand svg { width: 52px; height: 52px; filter: drop-shadow(0 8px 22px rgba(91, 102, 240, 0.55)); }
  h1 { font-size: 50px; line-height: 1.08; font-weight: 600; letter-spacing: -0.03em; }
  p { font-size: 22px; line-height: 1.45; color: #9ba1ab; }
  .url { font-family: GeistMono, monospace; font-size: 18px; color: #8a95ff; }
  .shot {
    position: absolute; left: ${width - 520}px; top: 92px; width: 1100px;
    border-radius: 14px; border: 1px solid rgba(255, 255, 255, 0.1); overflow: hidden;
    box-shadow: 0 40px 100px -20px rgba(0, 0, 0, 0.8), 0 0 0 8px rgba(255, 255, 255, 0.02);
  }
  .shot img { display: block; width: 100%; -webkit-mask-image: linear-gradient(180deg, #000 55%, transparent 96%); }
</style></head><body>
  <div class="shot"><img src="${shot}" alt=""></div>
  <div class="copy">
    <div class="brand">${markSvg()}Beacon</div>
    <h1>Acquisition targets, sourced with evidence you can check.</h1>
    <p>Every value carries its source. Analysts' decisions become the screening rules for the next search.</p>
    <div class="url">beacon.lukeghanna.com</div>
  </div>
</body></html>`;
}

async function renderCard(page: Page, width: number, height: number): Promise<Buffer> {
  await page.setViewportSize({ width, height });
  await page.setContent(cardHtml(width, height), { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  return page.screenshot({ type: "png" });
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    writeFileSync(path.join(PUBLIC, "favicon.svg"), markSvg());
    // One page renders one image at a time.
    const pngs: { size: number; png: Buffer }[] = [];
    for (const size of [16, 32, 48]) {
      pngs.push({ size, png: await renderSvg(page, markSvg(), size) });
    }
    writeFileSync(path.join(PUBLIC, "favicon.ico"), ico(pngs));
    writeFileSync(
      path.join(PUBLIC, "apple-touch-icon.png"),
      await renderSvg(page, markSvg({ bleed: true, lens: 0.17 }), 180),
    );
    writeFileSync(path.join(PUBLIC, "icon-192.png"), await renderSvg(page, markSvg(), 192));
    writeFileSync(path.join(PUBLIC, "icon-512.png"), await renderSvg(page, markSvg(), 512));
    writeFileSync(
      path.join(PUBLIC, "icon-maskable-512.png"),
      await renderSvg(page, markSvg({ bleed: true, lens: 0.15 }), 512),
    );
    writeFileSync(path.join(PUBLIC, "og.png"), await renderCard(page, 1200, 630));
    writeFileSync(
      path.join(ROOT, "docs", "media", "social-preview.png"),
      await renderCard(page, 1280, 640),
    );
  } finally {
    await browser.close();
  }
}

await main();

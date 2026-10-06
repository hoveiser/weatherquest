// Live-site smoke: load the deployed app, capture console + page errors, and
// confirm the Kaboom canvas mounts. Screenshots are saved under docs/.
// This never prints any secret; it only reads the public GitHub Pages site.
import { chromium } from "playwright";
import fs from "node:fs";

const SITE_URL = "https://hoveiser.github.io/weatherquest/";
const DOCS = new URL("../../docs/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
fs.mkdirSync(DOCS, { recursive: true });

const errors = [];
const warnings = [];
const logs = [];

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
page.on("console", (m) => {
  const rec = { type: m.type(), text: m.text() };
  if (m.type() === "error") errors.push(rec);
  else if (m.type() === "warning") warnings.push(rec);
  else logs.push(rec);
});
page.on("pageerror", (e) => errors.push({ type: "pageerror", text: String(e && e.message ? e.message : e) }));

await page.goto(SITE_URL, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(2500);

const canvas = await page.locator("canvas").first();
const canvasCount = await page.locator("canvas").count();
const canvasBox = canvasCount ? await canvas.boundingBox() : null;
const title = await page.locator("h1").first().textContent().catch(() => null);

await page.screenshot({ path: DOCS + "ui-1-landing.png", fullPage: true });

const summary = {
  url: SITE_URL,
  page_title_h1: title,
  canvas_count: canvasCount,
  canvas_box: canvasBox,
  console_errors: errors,
  console_warnings_count: warnings.length,
};
console.log(JSON.stringify(summary, null, 2));
fs.writeFileSync(DOCS + "ui-load-report.json", JSON.stringify(summary, null, 2));

await browser.close();

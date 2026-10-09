// Throwaway feasibility probe: can production pixel reading work at all?
// Checks (a) createImageBitmap(canvas) + 2D getImageData, (b) element screenshot
// byte signature, so the level navigator can be built on a method that is proven
// to return real pixels rather than a cleared WebGL buffer.
import { chromium } from "playwright";

const SITE_URL = process.env.SITE_URL || "https://hoveiser.github.io/weatherquest/";
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const ctx = await browser.newContext({ viewport: { width: 1000, height: 950 } });
await ctx.addInitScript(() => { try { localStorage.setItem("wq:demo:notice:v1", "1"); } catch (e) {} });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto(SITE_URL, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1500);
await page.getByRole("button").filter({ hasText: "LVL 1" }).first().click();
await page.locator("canvas").first().waitFor({ state: "visible", timeout: 15000 });
await page.waitForTimeout(1500);
const box = await page.locator("canvas").first().boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(500);

const probe = await page.evaluate(async () => {
  const canvas = document.querySelector("canvas");
  if (!canvas) return { error: "no canvas" };
  const out = {
    canvasAttr: { w: canvas.width, h: canvas.height },
    cssBox: { w: canvas.clientWidth, h: canvas.clientHeight },
    ctxType: null,
    bitmap: null,
    pixels: {},
  };
  try {
    const bmp = await createImageBitmap(canvas);
    out.bitmap = { w: bmp.width, h: bmp.height };
    const c2 = document.createElement("canvas");
    c2.width = bmp.width;
    c2.height = bmp.height;
    const g = c2.getContext("2d", { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    const at = (cx, cy) => {
      const d = g.getImageData(Math.round(cx * (bmp.width / 704)), Math.round(cy * (bmp.height / 448)), 1, 1).data;
      return [d[0], d[1], d[2], d[3]];
    };
    // logical 32px tiles: spawn cell (c1,r11) center, gate col 16 rows 7-8, river band
    out.pixels.spawn = at(1 * 32 + 16, 11 * 32 + 16);
    out.pixels.grass = at(3 * 32 + 16, 12 * 32 + 16);
    out.pixels.wall = at(0, 0);
    out.pixels.river = at(9 * 32 + 16, 4 * 32 + 16);
    out.pixels.gate = at(16 * 32 + 16, 8 * 32 + 16);
    out.pixels.victory = at(18 * 32 + 16, 8 * 32 + 16);
  } catch (e) {
    out.error = String(e);
  }
  return out;
});
console.log("evaluate probe:", JSON.stringify(probe, null, 2));

const shotBuf = await page.locator("canvas").first().screenshot();
console.log("screenshot bytes:", shotBuf.length, "sig:", shotBuf.subarray(0, 8).toString("hex"));

// count non-black pixels in the screenshot by decoding with an Image() in page context
const decoded = await page.evaluate(async (b64) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let orange = 0, sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    sum += d[i] + d[i + 1] + d[i + 2];
    if (d[i] > 230 && d[i + 1] > 130 && d[i + 1] < 190 && d[i + 2] < 90) orange++;
  }
  return { w: img.width, h: img.height, mean: sum / (d.length / 4), orangePixels: orange };
}, shotBuf.toString("base64"));
console.log("screenshot decoded in page:", JSON.stringify(decoded));

await ctx.close();
await browser.close();

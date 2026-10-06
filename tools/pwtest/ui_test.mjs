// Live-site functional test for WeatherGate (item 5).
// Drives the REAL production bundle at https://hoveiser.github.io/weatherquest/
// (dev seams __wgOpenGate/__wgWin are stripped in prod, so everything here uses
// genuine user interactions: level buttons, keyboard movement, gate walking,
// modal clicks, and an injected EIP-1193 provider for the wallet flow).
// Screenshots + a machine-readable report are written under docs/. No secrets.
import { chromium } from "playwright";
import fs from "node:fs";
import crypto from "node:crypto";

const SITE_URL = "https://hoveiser.github.io/weatherquest/";
const STUDIO_RPC = "https://studio.genlayer.com/api";
const DOCS = new URL("../../docs/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
fs.mkdirSync(DOCS, { recursive: true });

const report = { url: SITE_URL, console_errors: [], cases: {} };
function shot(page, name) {
  return page.screenshot({ path: DOCS + name, fullPage: true });
}

// A throwaway 20-byte address for the connect-only (read) flow.
const THROWAWAY_ADDR = "0x" + crypto.randomBytes(20).toString("hex");

// ---------------------------------------------------------------- helpers ---
async function readSteps(page) {
  const t = await page.locator("text=/steps · optimal/").first().textContent().catch(() => null);
  if (!t) return null;
  const m = t.match(/(\d+)\s*steps/);
  return m ? parseInt(m[1], 10) : null;
}
async function hold(page, key, ms) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}
async function canvasCenter(page) {
  const box = await page.locator("canvas").first().boundingBox();
  return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2, box } : null;
}
async function enterLevel1(page) {
  await page.getByRole("button").filter({ hasText: "LVL 1" }).first().click();
  await page.locator("canvas").first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(1200);
  const c = await canvasCenter(page);
  if (c) await page.mouse.click(c.x, c.y); // focus the Kaboom canvas for key input
  await page.waitForTimeout(300);
}

// EIP-1193 provider source, templated with the throwaway address + a mode.
// mode: "readonly" (connect + reads only) or "reject" (eth_sendTransaction throws 4001).
function providerInit(addr, mode) {
  return `
  (function(){
    var ADDR = ${JSON.stringify(addr)};
    var MODE = ${JSON.stringify(mode)};
    var listeners = {};
    var provider = {
      isMetaMask: true,
      _addr: ADDR,
      request: async function (args) {
        var method = args.method, params = args.params || [];
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [ADDR];
        if (method === "eth_chainId") return "0xf22f";
        if (method === "net_version") return "61999";
        if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
        if (method === "personal_sign" || method === "eth_sendTransaction") {
          if (MODE === "reject") {
            var e = new Error("User rejected the transaction.");
            e.code = 4001;
            throw e;
          }
        }
        if (window.__WG_rpc) return await window.__WG_rpc(method, params);
        throw new Error("no node rpc bridge for " + method);
      },
      on: function (ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); },
      removeListener: function () {},
      removeAllListeners: function () {},
    };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    window.dispatchEvent(new Event("ethereum#initialized"));
  })();`;
}

// ------------------------------------------------------------------ setup ---
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});

// Node-side JSON-RPC forwarder (avoids browser CORS against the StudioNet RPC).
async function wgRpc(method, params) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params });
  const res = await fetch(STUDIO_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  const j = await res.json();
  if (j.error) {
    const err = new Error(j.error.message || JSON.stringify(j.error));
    err.code = j.error.code;
    throw err;
  }
  return j.result;
}

// ============================ CASE 1: load + game + movement + gate + demo ===
{
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 950 } });
  await ctx.addInitScript(() => {
    try { localStorage.setItem("wq:demo:notice:v1", "1"); } catch (e) {}
  });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") report.console_errors.push(m.text());
  });
  page.on("pageerror", (e) => report.console_errors.push("pageerror: " + e.message));

  await page.goto(SITE_URL, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);
  const title = await page.locator("h1").first().textContent().catch(() => null);
  await shot(page, "ui-1-landing.png");
  report.cases.load = { h1: title, console_errors_at_load: report.console_errors.length };

  // enter Level 1 (mounts the canvas)
  await enterLevel1(page);
  await shot(page, "ui-2-dashboard.png");
  const steps0 = await readSteps(page);
  report.cases.level_entry = { canvas_present: (await page.locator("canvas").count()) > 0, steps_at_spawn: steps0 };

  // ---- wall collision: press LEFT from spawn; the border wall must stop us (steps stay 0)
  await hold(page, "a", 1200);
  const stepsAfterLeft = await readSteps(page);
  await shot(page, "ui-3-wall-left.png");

  // ---- WASD movement: press RIGHT; grid-cell transitions must increase
  await hold(page, "d", 1600);
  const stepsAfterRight = await readSteps(page);
  await shot(page, "ui-4-moved-right.png");
  report.cases.movement_collision = {
    steps_spawn: steps0,
    steps_after_left_hold: stepsAfterLeft,
    steps_after_right_hold: stepsAfterRight,
    wall_blocked_left: stepsAfterLeft === 0,
    moved_right: stepsAfterRight != null && stepsAfterRight > 0,
  };

  // ---- walk to the Magic Gate to open the challenge modal
  // re-enter fresh, then up one row band and right into the gate
  await page.getByRole("button", { name: /← Levels/ }).first().click().catch(() => {});
  await page.waitForTimeout(500);
  await enterLevel1(page);
  let modalOpen = false;
  await hold(page, "w", 450); // lift to a gate row (rows 7-9)
  for (let i = 0; i < 8 && !modalOpen; i++) {
    await hold(page, "d", 600);
    modalOpen = await page.locator("text=Magic Gate Locked").first().isVisible().catch(() => false);
  }
  if (!modalOpen) { await hold(page, "w", 300); await hold(page, "d", 600); }
  modalOpen = await page.locator("text=Magic Gate Locked").first().isVisible().catch(() => false);
  await shot(page, "ui-5-gate-modal.png");
  report.cases.gate_modal = { modal_opened: modalOpen };

  // ---- DEMO MODE: fill a cautious custom action, submit, expect a pass verdict
  let demo = { submitted: false };
  if (modalOpen) {
    await page.locator("input[placeholder='Or type your own custom action...']").fill("take shelter indoors and prepare equipment");
    await page.getByRole("button", { name: "Submit" }).click();
    demo.submitted = true;
    // demo path has a ~1.4s simulated delay; wait for a verdict heading
    let passed = false;
    for (let i = 0; i < 10 && !passed; i++) {
      await page.waitForTimeout(1000);
      passed = await page.locator("text=Quest Passed").first().isVisible().catch(() => false);
    }
    demo.passed_verdict = passed;
    await shot(page, "ui-6-demo-pass.png");
    if (passed) {
      await page.getByRole("button", { name: /Open the gate/ }).first().click().catch(() => {});
      await page.waitForTimeout(500);
      demo.gate_unlocked_heading = await page.locator("text=Gate Unlocked").first().isVisible().catch(() => false);
    }
  }
  report.cases.demo_complete = demo;
  await ctx.close();
}

// ================= CASE 2: wallet-connect (read-only) + failed-tx UI =========
{
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 950 } });
  await ctx.addInitScript(() => {
    try { localStorage.setItem("wq:demo:notice:v1", "1"); } catch (e) {}
  });
  await ctx.exposeFunction("__WG_rpc", wgRpc);
  await ctx.addInitScript(providerInit(THROWAWAY_ADDR, "reject"));
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") report.console_errors.push(m.text());
  });
  page.on("pageerror", (e) => report.console_errors.push("pageerror: " + e.message));

  await page.goto(SITE_URL, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);

  await page.getByRole("button", { name: "Connect GenLayer Wallet" }).first().click();
  let onchain = false;
  for (let i = 0; i < 8 && !onchain; i++) {
    await page.waitForTimeout(1000);
    onchain = await page.locator("text=On-chain").first().isVisible().catch(() => false);
  }
  await shot(page, "ui-7-wallet-connected.png");
  const addrShown = await page.locator(`text=/0x${THROWAWAY_ADDR.slice(2, 6)}/`).first().isVisible().catch(() => false);
  report.cases.wallet_connect = { mode_shows_onchain: onchain, connected_address_shown: addrShown, throwaway_addr_prefix: THROWAWAY_ADDR.slice(0, 8) };

  // enter Level 1, walk to gate, submit -> wallet REJECTION must surface a clear,
  // non-frozen error and allow retry.
  await enterLevel1(page);
  let modalOpen = false;
  await hold(page, "w", 450);
  for (let i = 0; i < 8 && !modalOpen; i++) {
    await hold(page, "d", 600);
    modalOpen = await page.locator("text=Magic Gate Locked").first().isVisible().catch(() => false);
  }
  report.cases.failed_tx_gate_opened = modalOpen;
  let ftx = { modal_opened: modalOpen };
  if (modalOpen) {
    await page.locator("input[placeholder='Or type your own custom action...']").fill("take shelter indoors and prepare equipment");
    await page.getByRole("button", { name: "Submit" }).click();
    // wait for a verdict (rejection is near-instant; guard with timeout)
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(1000);
      const v = await page.locator("text=Transaction Failed").first().isVisible().catch(() => false);
      if (v) break;
    }
    ftx.transaction_failed = await page.locator("text=Transaction Failed").first().isVisible().catch(() => false);
    ftx.rejection_message = await page.locator("text=Transaction rejected by your wallet").first().isVisible().catch(() => false);
    await shot(page, "ui-8-tx-rejected.png");
    // not frozen: a retry control must be present and take us back to select
    const retryBtn = page.getByRole("button", { name: "Try a different action" }).first();
    ftx.retry_available = await retryBtn.isVisible().catch(() => false);
    if (ftx.retry_available) {
      await retryBtn.click();
      await page.waitForTimeout(400);
      ftx.back_to_select = await page.locator("text=Choose your action").first().isVisible().catch(() => false);
      await shot(page, "ui-9-retry-select.png");
    }
  }
  report.cases.failed_tx_ui = ftx;
  await ctx.close();
}

await browser.close();

report.console_errors = Array.from(new Set(report.console_errors));
fs.writeFileSync(DOCS + "ui-report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

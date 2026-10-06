// Live-site ON-CHAIN completion (item 5, the part never done before).
// Injects an EIP-1193 provider whose eth_sendTransaction is signed and relayed
// to StudioNet by a Node bridge using a THROWAWAY key (generated fresh here,
// never printed, never from .env). This drives one real complete_level through
// the production UI and then independently checks the tx on the network.
import { chromium } from "playwright";
import fs from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const SITE_URL = "https://hoveiser.github.io/weatherquest/";
const STUDIO_RPC = "https://studio.genlayer.com/api";
const DOCS = new URL("../../docs/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
fs.mkdirSync(DOCS, { recursive: true });

const report = { console_errors: [], steps: {} };
const pk = generatePrivateKey();
const account = privateKeyToAccount(pk); // throwaway signer
const ADDR = account.address;

async function wgRpc(method, params) {
  const res = await fetch(STUDIO_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params: params || [] }),
  });
  const j = await res.json();
  if (j.error) { const e = new Error(j.error.message || JSON.stringify(j.error)); e.code = j.error.code; throw e; }
  return j.result;
}

const submitted = [];
async function wgSendTx(tx) {
  // Replicate genlayer-js's local-account signing: legacy EIP-155 tx to the
  // consensus contract with chainId 61999, then eth_sendRawTransaction.
  const nonceHex = await wgRpc("eth_getTransactionCount", [ADDR, "pending"]);
  const gasPriceHex = await wgRpc("eth_gasPrice", []);
  const serialized = await account.signTransaction({
    from: ADDR,
    to: tx.to,
    data: tx.data,
    value: BigInt(tx.value || "0x0"),
    gas: BigInt(tx.gas || "0x30d40"),
    nonce: BigInt(nonceHex),
    gasPrice: BigInt(gasPriceHex),
    chainId: 61999,
  });
  const hash = await wgRpc("eth_sendRawTransaction", [serialized]);
  submitted.push({ hash, at: Date.now() });
  return hash;
}

function providerInit() {
  return `
  (function(){
    var ADDR = ${JSON.stringify(ADDR)};
    var provider = {
      isMetaMask: true,
      request: async function (a) {
        var m = a.method, p = a.params || [];
        if (m === "eth_requestAccounts" || m === "eth_accounts") return [ADDR];
        if (m === "eth_chainId") return "0xf22f";
        if (m === "net_version") return "61999";
        if (m === "wallet_switchEthereumChain" || m === "wallet_addEthereumChain") return null;
        if (m === "eth_sendTransaction") return await window.__WG_sendTx(p[0]);
        if (window.__WG_rpc) return await window.__WG_rpc(m, p);
        throw new Error("no bridge for " + m);
      },
      on: function () {}, removeListener: function () {}, removeAllListeners: function () {},
    };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
  })();`;
}

async function readSteps(page) {
  const t = await page.locator("text=/steps · optimal/").first().textContent().catch(() => null);
  const m = t && t.match(/(\d+)\s*steps/);
  return m ? parseInt(m[1], 10) : null;
}
async function hold(page, key, ms) { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); }
async function canvasCenter(page) { const b = await page.locator("canvas").first().boundingBox(); return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null; }
async function enterLevel1(page) {
  await page.getByRole("button").filter({ hasText: "LVL 1" }).first().click();
  await page.locator("canvas").first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(1200);
  const c = await canvasCenter(page); if (c) await page.mouse.click(c.x, c.y);
  await page.waitForTimeout(300);
}

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const ctx = await browser.newContext({ viewport: { width: 1000, height: 950 } });
await ctx.addInitScript(() => { try { localStorage.setItem("wq:demo:notice:v1", "1"); } catch (e) {} });
await ctx.exposeFunction("__WG_rpc", wgRpc);
await ctx.exposeFunction("__WG_sendTx", wgSendTx);
await ctx.addInitScript(providerInit());
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") report.console_errors.push(m.text()); });
page.on("pageerror", (e) => report.console_errors.push("pageerror: " + e.message));

await page.goto(SITE_URL, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(2000);

// connect (eth_requestAccounts + chainId + real reads forwarded to StudioNet)
await page.getByRole("button", { name: "Connect GenLayer Wallet" }).first().click();
let onchain = false;
for (let i = 0; i < 10 && !onchain; i++) { await page.waitForTimeout(1000); onchain = await page.locator("text=On-chain").first().isVisible().catch(() => false); }
report.steps.connected = onchain;
const balText = await page.locator("text=/GEN/").first().textContent().catch(() => null);
report.steps.balance_after_connect = balText;

await enterLevel1(page);
let modal = false;
await hold(page, "w", 450);
for (let i = 0; i < 8 && !modal; i++) { await hold(page, "d", 600); modal = await page.locator("text=Magic Gate Locked").first().isVisible().catch(() => false); }
report.steps.gate_opened = modal;

let verdict = {};
if (modal) {
  await page.locator("input[placeholder='Or type your own custom action...']").fill("take shelter indoors and prepare equipment");
  const t0 = Date.now();
  await page.getByRole("button", { name: "Submit" }).click();
  // observe which terminal state the UI reaches (do NOT assume)
  for (let i = 0; i < 70; i++) {
    await page.waitForTimeout(1000);
    verdict.passed = await page.locator("text=Quest Passed").first().isVisible().catch(() => false);
    verdict.congested = await page.locator("text=Validators congested").first().isVisible().catch(() => false);
    verdict.txFail = await page.locator("text=Transaction Failed").first().isVisible().catch(() => false);
    verdict.judging = await page.locator("text=AI Validators are analyzing").first().isVisible().catch(() => false);
    if (verdict.passed || verdict.congested || verdict.txFail) break;
  }
  verdict.seconds_to_verdict = Math.round((Date.now() - t0) / 1000);
  await page.screenshot({ path: DOCS + "ui-10-onchain-verdict.png", fullPage: true });
  if (verdict.passed) {
    verdict.tx_hash_shown = await page.locator("text=/tx/").first().textContent().catch(() => null);
    await page.getByRole("button", { name: /Reward sent|Open the gate/ }).first().click().catch(() => {});
    await page.waitForTimeout(600);
    verdict.gate_unlocked = await page.locator("text=Gate Unlocked").first().isVisible().catch(() => false);
    await page.screenshot({ path: DOCS + "ui-11-onchain-unlocked.png", fullPage: true });
  }
}
report.steps.verdict = verdict;
report.submitted = submitted;
report.signer_address = ADDR;

// Independent network verification of the submitted hash(es).
for (const s of submitted) {
  const receipt = await wgRpc("eth_getTransactionReceipt", [s.hash]).catch((e) => ({ err: String(e).slice(0, 80) }));
  const progress = await wgRpc("gen_call", [{ to: "0x8fc4bc489C30666D6cF846DB63aAEaDfD8475A72", from: ADDR, data: "0x", block_number: "latest" }]).catch(() => null);
  s.receipt = receipt;
}
await ctx.close();
await browser.close();

report.console_errors = Array.from(new Set(report.console_errors));
fs.writeFileSync(DOCS + "ui-onchain-report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

// Live-site ON-CHAIN completion (item 5, the part never done before).
// Injects an EIP-1193 provider whose eth_sendTransaction is signed and relayed
// to StudioNet by a Node bridge using a THROWAWAY key (generated fresh here,
// never printed, never from .env). This drives one real complete_level through
// the production UI and then independently checks the tx on the network.
import { chromium } from "playwright";
import fs from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// Where to run: defaults to the live GitHub Pages bundle, overridable with
// SITE_URL so the same harness can prove a freshly built local bundle (vite
// preview on :4173) against the real StudioNet contract.
const SITE_URL = process.env.SITE_URL || "https://hoveiser.github.io/weatherquest/";
const STUDIO_RPC = "https://studio.genlayer.com/api";
// The deployed contract to independently read native balances against.
const CONTRACT_ADDR = process.env.WQ_CONTRACT || "0x599EA254e19f7427Db0B158123ED1A21f28538fe";
const DOCS = new URL("../../docs/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
fs.mkdirSync(DOCS, { recursive: true });

const report = { console_errors: [], site_url: SITE_URL, steps: {} };
const pk = generatePrivateKey();
const account = privateKeyToAccount(pk); // throwaway signer (key never printed)
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

// Independent native GEN read straight from the node (not via the UI), so the
// balance delta is a network fact the report can stand on.
async function nativeWei(addr) {
  const hex = await wgRpc("eth_getBalance", [addr, "latest"]);
  return BigInt(hex);
}
const genOf = (wei) => Number(wei) / 1e18;

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

// menu shows a "Disconnect" control once connected (the address chip is in the in-game HUD)
report.steps.menu_disconnect_shown =
  (await page.getByRole("button", { name: "Disconnect" }).first().count().catch(() => 0)) > 0;

await enterLevel1(page);

// connected address chip lives in the in-game HUD (button title "Disconnect wallet",
// label shortAddr(address, 5) = ADDR.slice(0,7) + ... + ADDR.slice(-5))
const chip = page.locator('button[title="Disconnect wallet"]').first();
report.steps.address_chip_present = (await chip.count().catch(() => 0)) > 0;
const chipText = await chip.textContent().catch(() => null);
report.steps.address_chip_text = chipText;
report.steps.address_chip_matches_signer =
  !!chipText && chipText.includes(ADDR.slice(0, 7)) && chipText.includes(ADDR.slice(-5));
let modal = false;
await hold(page, "w", 450);
for (let i = 0; i < 8 && !modal; i++) { await hold(page, "d", 600); modal = await page.locator("text=Magic Gate Locked").first().isVisible().catch(() => false); }
report.steps.gate_opened = modal;

let verdict = {};
if (modal) {
  await page.locator("input[placeholder='Or type your own custom action...']").fill("take shelter indoors and prepare equipment");
  // P4 live check: capture the client previewRisk badge (tier + multiplier) before submitting
  report.steps.preview_multiplier_text = await page.getByText(/\d\.\dx/).first().textContent().catch(() => null);
  report.steps.preview_tier_text = await page.getByText(/^(Low|Medium|High|Extreme)$/).first().textContent().catch(() => null);
  await page.screenshot({ path: DOCS + "ui-13-gate-preview.png", fullPage: true });
  // Snapshot the throwaway wallet's NATIVE GEN balance straight from the node
  // right before the write, so the payout delta is measured independently.
  const balBeforeWei = await nativeWei(ADDR).catch(() => 0n);
  report.steps.native_before_gen = genOf(balBeforeWei);
  const t0 = Date.now();
  await page.getByRole("button", { name: "Submit" }).click();
  // observe which terminal state the UI reaches (do NOT assume). The on-chain
  // path now waits for consensus + a native-balance confirmation poll, so allow
  // up to ~150s before calling it stuck.
  for (let i = 0; i < 150; i++) {
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

    // ---- P2 settlement-proof assertions ----
    const link = page.locator('[data-testid="tx-hash-link"]').first();
    verdict.hash_link_exists = (await link.count()) > 0;
    verdict.hash_href = await link.getAttribute("href").catch(() => null);
    verdict.hash_title = await link.getAttribute("title").catch(() => null);
    verdict.hash_target = await link.getAttribute("target").catch(() => null);
    verdict.hash_rel = await link.getAttribute("rel").catch(() => null);
    // href must carry the full 66-char hash and point at the explorer
    const href = verdict.hash_href || "";
    verdict.hash_href_is_explorer = href.startsWith("https://explorer-studio.genlayer.com/tx/0x");
    verdict.hash_href_full66 = /0x[0-9a-fA-F]{64}$/.test(href);
    verdict.link_newtab_secure = verdict.hash_target === "_blank" && /noopener/.test(verdict.hash_rel || "") && /noreferrer/.test(verdict.hash_rel || "");
    // clicking opens the explorer in a new tab (target=_blank)
    const [popup] = await Promise.all([
      page.waitForEvent("popup", { timeout: 5000 }).catch(() => null),
      link.click().catch(() => {}),
    ]);
    verdict.popup_url = popup ? popup.url() : null;
    verdict.popup_is_explorer = !!(popup && popup.url().startsWith("https://explorer-studio.genlayer.com/tx/"));
    if (popup) await popup.close().catch(() => {});

    // payout status is shown separately and is NOT the old "reward sent" wording
    const payout = page.locator('[data-testid="payout-status"]').first();
    verdict.payout_status_text = await payout.textContent().catch(() => null);
    verdict.payout_status_shown = !!(verdict.payout_status_text || "").match(/Payout:/);
    verdict.no_reward_sent_wording = !!(verdict.payout_status_text || "") && !/reward sent/i.test(verdict.payout_status_text);

    // ---- native GEN delivery proof (the corrected claim) ----
    // StudioNet applies the emit_transfer on FINALIZED, which can lag the verdict
    // by a few seconds. Poll the wallet's NATIVE balance straight from the node.
    let balAfterWei = balBeforeWei;
    for (let i = 0; i < 10; i++) {
      balAfterWei = await nativeWei(ADDR).catch(() => balAfterWei);
      if (balAfterWei > balBeforeWei) break;
      await page.waitForTimeout(4000);
    }
    const deltaWei = balAfterWei - balBeforeWei;
    verdict.native_before_gen = genOf(balBeforeWei);
    verdict.native_after_gen = genOf(balAfterWei);
    verdict.native_delta_gen = genOf(deltaWei);
    verdict.native_delta_positive = deltaWei > 0n;
    // The UI's own payout line carries the credited GEN; parse it and require the
    // measured native delta to match what the app claims the wallet received.
    const shown = ((verdict.payout_status_text || "").match(/([\d.]+)\s*GEN/) || [])[1];
    verdict.payout_shown_gen = shown ? parseFloat(shown) : null;
    verdict.payout_says_received = /received in your wallet/i.test(verdict.payout_status_text || "");
    verdict.native_delta_matches_shown =
      verdict.payout_shown_gen != null &&
      Math.abs(verdict.native_delta_gen - verdict.payout_shown_gen) < 1e-9;

    // cross-check the displayed hash equals a real submitted tx hash
    const shownHash = (verdict.hash_title || "").toLowerCase();
    verdict.hash_matches_submitted = submitted.some((s) => s.hash.toLowerCase() === shownHash);

    await page.screenshot({ path: DOCS + "ui-12-settlement-proof.png", fullPage: true });
    // "Gate Unlocked" renders in the verdict modal on a passing run (before the modal closes)
    verdict.gate_unlocked_text = await page.getByText(/Gate Unlocked/).first().isVisible().catch(() => false);
    await page.getByRole("button", { name: /Open the gate/ }).first().click().catch(() => {});
    await page.waitForTimeout(600);
    verdict.gate_unlocked = verdict.gate_unlocked_text;
    await page.screenshot({ path: DOCS + "ui-11-onchain-unlocked.png", fullPage: true });
  }
}
report.steps.verdict = verdict;
report.submitted = submitted;
report.signer_address = ADDR;

// Independent network verification of the submitted hash(es).
for (const s of submitted) {
  const receipt = await wgRpc("eth_getTransactionReceipt", [s.hash]).catch((e) => ({ err: String(e).slice(0, 80) }));
  s.receipt = receipt;
}
report.contract_address = CONTRACT_ADDR;
report.wallet_final_native_gen = genOf(await nativeWei(ADDR).catch(() => 0n));
await ctx.close();
await browser.close();

report.console_errors = Array.from(new Set(report.console_errors));
fs.writeFileSync(DOCS + "ui-onchain-report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

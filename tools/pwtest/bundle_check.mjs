// Re-check the LIVE GitHub Pages bundle still bakes the new contract address.
// Fetches index.html, locates the hashed JS asset(s), and greps every asset for
// the address. Read-only GETs of public static files (no curl/wget).
const SITE = "https://hoveiser.github.io/weatherquest/";
const ADDR = process.env.WQ_CONTRACT || "0x6028EB222937cd0Bd881c85260E1e0F11330a0A3";
// Every prior deployment must be absent from the published bundle.
const OLD = [
  "0x599EA254e19f7427Db0B158123ED1A21f28538fe",
  "0x2d764187A908d1677510c5E7FE69e8e7C1810299",
  "0x8fc4bc489C30666D6cF846DB63aAEaDfD8475A72",
  "0x884974D0D16E087d925c690186687de9Ec2B20F9",
];

async function text(u) {
  const r = await fetch(u, { headers: { "user-agent": "wq-bundle-check" } });
  return { status: r.status, body: await r.text() };
}

const idx = await text(SITE + "index.html");
const base = SITE.replace(/\/$/, "") + "/";
const seen = new Set();
const queue = [...idx.body.matchAll(/assets\/[A-Za-z0-9_.-]+\.js/g)].map((m) => m[0]);
const out = { index_status: idx.status, hits: {}, old_hits: {} };
let guard = 0;
while (queue.length && guard < 40) {
  guard++;
  const name = queue.shift();
  if (seen.has(name)) continue;
  seen.add(name);
  const j = await text(base + name);
  const low = j.body.toLowerCase();
  const found = j.body.includes(ADDR) || low.includes(ADDR.toLowerCase());
  out.hits[name] = { status: j.status, bytes: j.body.length, contains_address: found };
  const presentOld = OLD.filter((o) => j.body.includes(o) || low.includes(o.toLowerCase()));
  if (presentOld.length) out.old_hits[name] = presentOld;
  for (const m of j.body.matchAll(/assets\/[A-Za-z0-9_.-]+\.js/g)) {
    if (!seen.has(m[0])) queue.push(m[0]);
  }
  // Vite emits dynamic-import chunk refs as "./name.js" relative to the
  // importer (which lives under assets/), so resolve them the same way.
  for (const m of j.body.matchAll(/["']\.\/([A-Za-z0-9_.-]+\.js)["']/g)) {
    const nm = "assets/" + m[1];
    if (!seen.has(nm)) queue.push(nm);
  }
}
out.assets_crawled = seen.size;
out.any_asset_contains_address = Object.values(out.hits).some((h) => h.contains_address);
out.verdict = out.any_asset_contains_address && Object.keys(out.old_hits).length === 0 ? "PASS" : "CHECK";
console.log(JSON.stringify(out, null, 2));

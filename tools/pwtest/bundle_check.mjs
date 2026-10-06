// Re-check the LIVE GitHub Pages bundle still bakes the new contract address.
// Fetches index.html, locates the hashed JS asset(s), and greps every asset for
// the address. Read-only GETs of public static files (no curl/wget).
const SITE = "https://hoveiser.github.io/weatherquest/";
const ADDR = "0x2d764187A908d1677510c5E7FE69e8e7C1810299";

async function text(u) {
  const r = await fetch(u, { headers: { "user-agent": "wq-bundle-check" } });
  return { status: r.status, body: await r.text() };
}

const idx = await text(SITE + "index.html");
const srcs = [...idx.body.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map((m) => m[1]);
const out = { index_status: idx.status, js_assets: srcs, hits: {} };
for (const s of srcs) {
  const url = s.startsWith("http") ? s : SITE.replace(/\/$/, "") + "/" + s.replace(/^\//, "");
  const j = await text(url);
  const found = j.body.includes(ADDR) || j.body.toLowerCase().includes(ADDR.toLowerCase());
  out.hits[url] = { status: j.status, bytes: j.body.length, contains_address: found };
}
out.any_asset_contains_address = Object.values(out.hits).some((h) => h.contains_address);
console.log(JSON.stringify(out, null, 2));

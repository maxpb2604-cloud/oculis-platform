/**
 * Headless capture of the Cámara de Diputados SIL "iniciativas" API request.
 *
 * Loads the live SPA, records every XHR/fetch to the SIL API, and prints the
 * full request (method, URL, headers, post body) plus a short response preview.
 * This lets us lock the paginated-list param/header contract without DevTools.
 *
 * Run: node scripts/capture-sil-request.mjs
 */
import { chromium } from "playwright";

const API_MATCH = /\/sil\/api\//i;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
});
const page = await ctx.newPage();

const seen = new Map();

page.on("request", (req) => {
  const url = req.url();
  if (!API_MATCH.test(url)) return;
  if (seen.has(url)) return;
  seen.set(url, {
    method: req.method(),
    url,
    headers: req.headers(),
    postData: req.postData() ?? null,
  });
});

page.on("response", async (res) => {
  const url = res.url();
  if (!API_MATCH.test(url)) return;
  try {
    const body = await res.text();
    const rec = seen.get(url) ?? { method: "GET", url, headers: {} };
    rec.status = res.status();
    if (/iniciativa/i.test(url)) rec.responsePreview = body.slice(0, 500);
    seen.set(url, rec);
  } catch {
    // Response bodies can be unavailable for redirects or aborted requests.
  }
});

// Load the app, then navigate the SPA into the Iniciativas section so its
// list request actually fires.
await page.goto("https://www.diputadosrd.gob.do/sil/", {
  waitUntil: "networkidle",
  timeout: 45_000,
});
await page.waitForTimeout(2500);

// Try clicking any nav element that routes to initiatives.
const clickTargets = [
  'a[href*="iniciativa"]',
  'a:has-text("Iniciativa")',
  'text=/Iniciativas/i',
];
for (const sel of clickTargets) {
  try {
    const el = page.locator(sel).first();
    if (await el.count()) {
      await el.click({ timeout: 5000 });
      await page.waitForTimeout(3500);
      break;
    }
  } catch (e) {
    console.error(`click ${sel}: ${e.message}`);
  }
}
// Direct route to the initiatives section.
try {
  await page.goto("https://www.diputadosrd.gob.do/sil/iniciativa", {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await page.waitForTimeout(3000);
} catch (e) {
  console.error(`nav iniciativa: ${e.message}`);
}

// The section shows subject groups first; click a few to trigger the list call.
for (const label of ["Economía", "Agricultura", "Administración"]) {
  try {
    const el = page.locator(`text=/${label}/`).first();
    if (await el.count()) {
      await el.click({ timeout: 5000 });
      await page.waitForTimeout(3500);
    }
  } catch (e) {
    console.error(`click ${label}: ${e.message}`);
  }
}
// After a group is open, click into its materias to reach the actual list.
const materiaLabels = [
  "DEUDA EXTERNA",
  "OBRAS PÚBLICAS",
  "ADMINISTRACIÓN",
  "PRESUPUESTO",
  "TRIBUTACIÓN",
];
for (const label of materiaLabels) {
  try {
    const el = page.locator(`text=/${label}/i`).first();
    if (await el.count()) {
      await el.click({ timeout: 4000 });
      await page.waitForTimeout(3500);
    }
  } catch {
    // Optional discovery click; continue with the remaining labels.
  }
}

// Dump current DOM links/buttons to reveal the SPA's list route.
const dom = await page.evaluate(() => {
  const anchors = [...document.querySelectorAll("a[href]")]
    .map((a) => a.getAttribute("href"))
    .filter((h) => h && /iniciativa|materia|grupo/i.test(h));
  const buttons = [...document.querySelectorAll("button, [role=button]")]
    .map((b) => (b.textContent || "").trim())
    .filter((t) => t && t.length < 40)
    .slice(0, 25);
  return { anchors: [...new Set(anchors)].slice(0, 30), buttons, url: location.href };
});
console.log("\n---- DOM after navigation ----");
console.log("current url:", dom.url);
console.log("links:", JSON.stringify(dom.anchors, null, 0));
console.log("buttons:", JSON.stringify(dom.buttons, null, 0));

console.log("\n================ CAPTURED SIL API REQUESTS ================\n");
const list = [...seen.values()].sort((a, b) =>
  (a.url || "").localeCompare(b.url || ""),
);
for (const r of list) {
  console.log(`${r.method} ${r.url}`);
  if (r.status) console.log(`  -> status ${r.status}`);
  const interesting = Object.fromEntries(
    Object.entries(r.headers || {}).filter(([k]) =>
      /^(authorization|x-|apikey|api-key|ocp-|verificationtoken|requestverificationtoken|content-type|accept|referer|origin|cookie)/i.test(
        k,
      ),
    ),
  );
  if (Object.keys(interesting).length)
    console.log(`  headers: ${JSON.stringify(interesting)}`);
  if (r.postData) console.log(`  body: ${r.postData}`);
  if (r.responsePreview) console.log(`  resp: ${r.responsePreview}`);
  console.log("");
}
if (!list.length) console.log("(no SIL API requests captured)");

await browser.close();

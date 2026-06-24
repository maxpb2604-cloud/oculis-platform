/**
 * Live validation for the Senate SIL deposits scraper. Hits the real legacy site,
 * logs the public login result and a sample of parsed deposits. Run:
 *   npx tsx packages/scrapers/scripts/validate-senado-sil.ts
 */
import { SenadoSilAdapter } from "../src/senado-sil.js";

async function main() {
  const adapter = new SenadoSilAdapter();

  console.log("→ logging in (public consultation)…");
  const jar = await adapter.loginPublic();
  console.log("  session cookie:", jar.has("ASP.NET_SessionId") ? "ASP.NET_SessionId ✓" : "✗ none");

  console.log("→ fetching deposited initiatives (current collection)…");
  const all = await adapter.listDeposits();
  console.log(`  parsed rows: ${all.length}`);

  // Last 7 days window, to mirror what the daily feed would request.
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const recent = await adapter.listDeposits({ since: weekAgo, until: today });
  console.log(`  filed in [${weekAgo} … ${today}]: ${recent.length}`);

  console.log("\nSample (first 8):");
  for (const r of all.slice(0, 8)) {
    console.log(
      `  ${r.filedAt ?? "????-??-??"}  ${r.code.padEnd(18)}  ${(r.type ?? "").padEnd(16)}  ${r.status ?? ""}`,
    );
    if (r.title) console.log(`      ${r.title.slice(0, 90)}`);
  }

  // Basic integrity checks.
  const withDate = all.filter((r) => r.filedAt).length;
  const withCode = all.filter((r) => r.code).length;
  const withUrl = all.filter((r) => r.sourceUrl).length;
  console.log(
    `\nIntegrity: code ${withCode}/${all.length} · date ${withDate}/${all.length} · sourceUrl ${withUrl}/${all.length}`,
  );
  if (all.length === 0) throw new Error("No rows parsed — scraper likely broken");
  console.log("✓ validation passed");
}

main().catch((e) => {
  console.error("✗ validation failed:", e);
  process.exit(1);
});

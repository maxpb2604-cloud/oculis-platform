/**
 * Validate evidence-backed institutional accounts and emit deterministic seed rows.
 *
 * This utility does not discover, rank, classify, or select accounts. Every input row
 * must already contain the institution name, handle, chamber and a primary-source URL
 * that explicitly identifies the account. Invalid or incomplete input fails as a whole.
 *
 * Usage: node scripts/build-accounts-seed.mjs <accounts.json>
 */
import { readFileSync } from "node:fs";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("usage: node scripts/build-accounts-seed.mjs <accounts.json>");
  process.exit(1);
}

const rows = JSON.parse(readFileSync(inputPath, "utf8"));
if (!Array.isArray(rows)) throw new Error("accounts.json must contain an array");

const handlePattern = /^@[A-Za-z0-9_]{1,15}$/;
const allowedKinds = new Set(["SENADO_OFFICIAL", "INSTITUTION"]);
const allowedChambers = new Set(["SENADO", "DIPUTADOS"]);
const seen = new Set();

for (const [index, row] of rows.entries()) {
  const required = ["name", "handle", "kind", "chamber", "evidenceUrl", "verifiedAt"];
  for (const key of required) {
    if (typeof row?.[key] !== "string" || !row[key].trim()) {
      throw new Error(`row ${index}: ${key} is required and must be explicit`);
    }
  }
  if (!handlePattern.test(row.handle)) throw new Error(`row ${index}: invalid X handle`);
  if (!allowedKinds.has(row.kind)) throw new Error(`row ${index}: unsupported explicit kind`);
  if (!allowedChambers.has(row.chamber)) throw new Error(`row ${index}: invalid chamber`);
  if (!/^https:\/\//.test(row.evidenceUrl)) {
    throw new Error(`row ${index}: evidenceUrl must be an HTTPS primary-source URL`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.verifiedAt)) {
    throw new Error(`row ${index}: verifiedAt must be YYYY-MM-DD`);
  }
  const key = row.handle.toLowerCase();
  if (seen.has(key)) throw new Error(`row ${index}: duplicate handle ${row.handle}`);
  seen.add(key);
}

const escapeString = (value) =>
  JSON.stringify(String(value)).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

const sorted = [...rows].sort((a, b) =>
  a.name.localeCompare(b.name, "es", { sensitivity: "base" }),
);

for (const row of sorted) {
  const handle = row.handle.slice(1);
  console.log("  {");
  console.log(`    name: ${escapeString(row.name)},`);
  console.log(`    handle: ${escapeString(row.handle)},`);
  console.log('    platform: "X",');
  console.log(`    url: ${escapeString(`https://x.com/${handle}`)},`);
  console.log(`    kind: ${escapeString(row.kind)},`);
  console.log(`    chamber: ${escapeString(row.chamber)},`);
  console.log(`    evidenceUrl: ${escapeString(row.evidenceUrl)},`);
  console.log(`    verifiedAt: ${escapeString(row.verifiedAt)},`);
  console.log("  },");
}

console.error(`Validated ${sorted.length} evidence-backed account(s); emitted A→Z.`);

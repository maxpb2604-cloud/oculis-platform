/**
 * CI guard for FACTUAL_DATA_POLICY.md.
 *
 * The legacy platform included optional prediction/classification code. Oculis now
 * has a factual-only runtime, so these identifiers must not return to ingestion,
 * presentation, scraper, or domain code without an explicit product-policy change.
 */
import { readFile, readdir } from "node:fs/promises";
import { extname, relative } from "node:path";

const root = new URL("../", import.meta.url);
const sourceRoots = [
  "apps/worker/src",
  "apps/web/src",
  "packages/core/src",
  "packages/scrapers/src",
  ".github/workflows",
];
const extensions = new Set([".ts", ".tsx", ".js", ".mjs", ".yml", ".yaml"]);
const forbidden = [
  "@anthropic-ai/sdk",
  "ANTHROPIC_API_KEY",
  "OCULIS_USE_CLAUDE",
  "approvalProbability",
  "approvalScore",
  "riskLevel",
  "categoryConfidence",
  "interventionLevel",
  "createCategorizer",
  "createScoreEstimator",
  "scoreInitiative",
];

async function filesUnder(path) {
  const absolute = new URL(`${path}/`, root);
  const entries = await readdir(absolute, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = new URL(entry.name, absolute);
    if (entry.isDirectory()) files.push(...(await filesUnder(`${path}/${entry.name}`)));
    else if (entry.isFile() && extensions.has(extname(entry.name))) files.push(child);
  }
  return files;
}

const violations = [];
for (const sourceRoot of sourceRoots) {
  for (const file of await filesUnder(sourceRoot)) {
    const body = await readFile(file, "utf8");
    for (const token of forbidden) {
      if (body.includes(token)) {
        violations.push(`${relative(new URL(".", root).pathname, file.pathname)}: ${token}`);
      }
    }
  }
}

const workerPackage = JSON.parse(await readFile(new URL("apps/worker/package.json", root), "utf8"));
if (workerPackage.dependencies?.["@anthropic-ai/sdk"]) {
  violations.push("apps/worker/package.json: @anthropic-ai/sdk");
}
if (workerPackage.scripts?.rescore) {
  violations.push("apps/worker/package.json: rescore script");
}

const lockfile = await readFile(new URL("package-lock.json", root), "utf8");
for (const token of ["@anthropic-ai/sdk", "anthropic-ai-sdk"]) {
  if (lockfile.includes(token)) violations.push(`package-lock.json: ${token}`);
}

const envExample = await readFile(new URL(".env.example", root), "utf8");
for (const token of ["ANTHROPIC_API_KEY", "OCULIS_USE_CLAUDE"]) {
  if (envExample.includes(token)) violations.push(`.env.example: ${token}`);
}

if (violations.length) {
  console.error("Factual-data policy violations:\n" + violations.map((v) => `- ${v}`).join("\n"));
  process.exit(1);
}

console.log("Factual-data policy: OK");

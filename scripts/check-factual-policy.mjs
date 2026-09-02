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
  "OPENAI_API_KEY",
  "OCULIS_SUMMARY_MODEL",
  "api.openai.com/v1/responses",
  "OpenAIResponsesSummaryProvider",
];
const translationOnlyTokens = [
  "@huggingface/transformers",
  "Xenova/nllb-200-distilled-600M",
  "261c31d1a5732c67cdd16d80e8d6088507c7ccea",
  "spa_Latn",
  "eng_Latn",
];
const translationOnlyFiles = new Set(["apps/worker/src/translate-initiative-titles.ts"]);

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
    const projectPath = relative(new URL(".", root).pathname, file.pathname);
    for (const token of forbidden) {
      if (body.includes(token)) {
        violations.push(`${projectPath}: ${token}`);
      }
    }
    if (!translationOnlyFiles.has(projectPath)) {
      for (const token of translationOnlyTokens) {
        if (body.includes(token)) {
          violations.push(`${projectPath}: ${token} outside title-translation worker`);
        }
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
if (workerPackage.scripts?.["verify-documents"] !== "tsx src/verify-documents.ts") {
  violations.push("apps/worker/package.json: missing isolated verify-documents script");
}
if (
  workerPackage.scripts?.["translate-initiative-titles"] !==
  "tsx src/translate-initiative-titles.ts"
) {
  violations.push("apps/worker/package.json: missing isolated translate-initiative-titles script");
}
if (
  workerPackage.scripts?.["import-reviewed-initiative-titles"] !==
  "tsx src/import-reviewed-initiative-titles.ts"
) {
  violations.push("apps/worker/package.json: missing isolated reviewed-title import script");
}
if (
  workerPackage.scripts?.["link:initiative-proponents"] !==
  "tsx src/index.ts --link-initiative-proponents"
) {
  violations.push("apps/worker/package.json: missing exact initiative-proponent linker script");
}
if (workerPackage.dependencies?.["@huggingface/transformers"] !== "3.8.1") {
  violations.push(
    "apps/worker/package.json: title translator must pin @huggingface/transformers 3.8.1",
  );
}
for (const name of ["summarize-documents", "review-summaries", "verify-summaries"]) {
  if (workerPackage.scripts?.[name]) {
    violations.push(`apps/worker/package.json: removed summary script returned: ${name}`);
  }
}

for (const entrypoint of ["apps/worker/src/index.ts", "apps/worker/src/daily.ts"]) {
  const body = await readFile(new URL(entrypoint, root), "utf8");
  if (
    /translate-initiative-titles|opus-mt-es-en|nllb-200-distilled-600M|spa_Latn|eng_Latn|@huggingface\/transformers/.test(
      body,
    )
  ) {
    violations.push(`${entrypoint}: title translation connected to ingestion`);
  }
}

const proponentLinkerPath = "apps/worker/src/link-initiative-proponents.ts";
const proponentLinker = await readFile(new URL(proponentLinkerPath, root), "utf8");
for (const required of [
  "DIPUTADOS_SIL_PERSON_NAMESPACE",
  "SENADO_SIL_PERSON_NAMESPACE",
  "resolveSenadoSilFichaProponents",
  "REVIEWED_SENADO_SIL_PERSON_BRIDGE",
  "replaceInitiativeProponents",
  "skippedUnobserved",
]) {
  if (!proponentLinker.includes(required)) {
    violations.push(`${proponentLinkerPath}: missing exact-identity guard ${required}`);
  }
}
if (/levenshtein|jaro|fuzzy|string[-_]similarity|edit[-_ ]distance/i.test(proponentLinker)) {
  violations.push(`${proponentLinkerPath}: approximate person matching is forbidden`);
}

const titleTranslationPath = "apps/worker/src/translate-initiative-titles.ts";
const titleTranslationWorker = await readFile(new URL(titleTranslationPath, root), "utf8");
for (const required of [
  "Xenova/nllb-200-distilled-600M",
  "261c31d1a5732c67cdd16d80e8d6088507c7ccea",
  'INITIATIVE_TITLE_TRANSLATION_PIPELINE_VERSION = "v4"',
  'src_lang: "spa_Latn"',
  'tgt_lang: "eng_Latn"',
  "listInitiativeTitleTranslationCandidates",
  "storeInitiativeTitleTranslation",
  "createHash",
  "DOMINICAN_PROVINCE_NAMES",
  "DOMINICAN_PROVINCE_SOURCE_ALIASES",
  "DOMINICAN_PROVINCE_LITERAL_PATTERN",
  "splitProtectedChunkAtSpanishConjunctions",
  "repairInitiativeTitleLeadingZeroIntegers",
  "validateInitiativeTitleNumericIntegrity",
]) {
  if (!titleTranslationWorker.includes(required)) {
    violations.push(`${titleTranslationPath}: missing isolated translation guard ${required}`);
  }
}
if (titleTranslationWorker.includes("Xenova/opus-mt-es-en")) {
  violations.push(`${titleTranslationPath}: legacy Opus title model must not return`);
}
if (/api\.openai\.com|OPENAI_API_KEY|tools\s*:/.test(titleTranslationWorker)) {
  violations.push(`${titleTranslationPath}: title translation must remain offline and tool-free`);
}

const dbRepository = await readFile(new URL("packages/db/src/repository.ts", root), "utf8");
for (const required of [
  'REVIEWED_INITIATIVE_TITLE_MODEL_PREFIX = "oculis-editorial-reviewed-en/"',
  "title_translation.model like",
]) {
  if (!dbRepository.includes(required)) {
    violations.push(
      `packages/db/src/repository.ts: missing reviewed title publication gate ${required}`,
    );
  }
}

const reviewedTitleImporter = await readFile(
  new URL("apps/worker/src/import-reviewed-initiative-titles.ts", root),
  "utf8",
);
for (const required of [
  "--confirm-reviewed-against-official-title",
  "REVIEWED_INITIATIVE_TITLE_MODEL_PREFIX",
  "validateInitiativeTitleNumericIntegrity",
  "storeInitiativeTitleTranslation",
]) {
  if (!reviewedTitleImporter.includes(required)) {
    violations.push(
      `apps/worker/src/import-reviewed-initiative-titles.ts: missing publication guard ${required}`,
    );
  }
}

const documentVerifierPath = "apps/worker/src/verify-documents.ts";
const documentVerifier = await readFile(new URL(documentVerifierPath, root), "utf8");
for (const required of [
  "beginOrResumeDocumentPdfVerificationCycle",
  "checkpointDocumentPdfVerificationCycle",
  "finishDocumentPdfVerificationCycle",
  "DOCUMENT_PDF_VERIFICATION_MAX_CYCLE_AGE_MS",
  "cycle.cycleStartedAtMs",
  "atOrBeforeDocumentId: cycle.cycleMaxDocumentId",
  "verificationDueOnly: true",
]) {
  if (!documentVerifier.includes(required)) {
    violations.push(`${documentVerifierPath}: missing durable-cycle guard ${required}`);
  }
}
for (const forbiddenToken of [
  "OpenAIResponsesSummaryProvider",
  "OCULIS_SUMMARY_MODEL",
  "api.openai.com/v1/responses",
]) {
  if (documentVerifier.includes(forbiddenToken)) {
    violations.push(`${documentVerifierPath}: byte verifier must not use ${forbiddenToken}`);
  }
}

const repositoryPath = "packages/db/src/repository.ts";
const repository = await readFile(new URL(repositoryPath, root), "utf8");
for (const required of [
  "freshness === \"availability\" ? sql`interval '24 hours'` : sql`interval '12 hours'`",
  "currentDocumentPdfVerificationDue()",
  "DOCUMENT_PDF_VERIFICATION_RUN_SOURCE",
  "verificationDueOnly?: boolean",
]) {
  if (!repository.includes(required)) {
    violations.push(`${repositoryPath}: missing pre-expiry PDF verification guard ${required}`);
  }
}

const cloudWorkflowPath = ".github/workflows/cloud-ingestion.yml";
const cloudWorkflow = await readFile(new URL(cloudWorkflowPath, root), "utf8");
if (!cloudWorkflow.includes('- cron: "15 2,10,18 * * *"')) {
  violations.push(`${cloudWorkflowPath}: missing eight-hour verification schedule`);
}
for (const required of [
  "          - publications-full",
  "id: manual_full_publications",
  "inputs.mode == 'publications-full'",
  "run: npm run publications -w @oculis/worker -- --full",
]) {
  if (!cloudWorkflow.includes(required)) {
    violations.push(`${cloudWorkflowPath}: missing manual full-publication recovery ${required}`);
  }
}
const documentVerificationStepName = "      - name: Verify deposited bill PDFs (byte-only)";
const documentVerificationStart = cloudWorkflow.indexOf(documentVerificationStepName);
if (documentVerificationStart === -1) {
  violations.push(`${cloudWorkflowPath}: missing scheduled byte-only document verification`);
} else {
  const nextStepStart = cloudWorkflow.indexOf("\n      - name:", documentVerificationStart + 1);
  const documentVerificationStep = cloudWorkflow.slice(
    documentVerificationStart,
    nextStepStart === -1 ? undefined : nextStepStart,
  );
  for (const required of [
    "id: verify_documents",
    "github.event_name == 'schedule'",
    "github.event.schedule == '15 2,10,18 * * *'",
    "timeout-minutes: 30",
    "run: npm run verify-documents -w @oculis/worker -- --all",
  ]) {
    if (!documentVerificationStep.includes(required)) {
      violations.push(`${cloudWorkflowPath}: document verification missing ${required}`);
    }
  }
  if (documentVerificationStep.includes("workflow_dispatch")) {
    violations.push(`${cloudWorkflowPath}: document verification must remain scheduled-only`);
  }
  if (/continue-on-error:\s*true/.test(documentVerificationStep)) {
    violations.push(`${cloudWorkflowPath}: document verification failures must remain visible`);
  }
}
const databaseConfigurationStart = cloudWorkflow.indexOf("- name: Verify database configuration");
if (databaseConfigurationStart === -1) {
  violations.push(`${cloudWorkflowPath}: missing cloud database configuration check`);
}
if (
  databaseConfigurationStart !== -1 &&
  documentVerificationStart !== -1 &&
  documentVerificationStart < databaseConfigurationStart
) {
  violations.push(`${cloudWorkflowPath}: document verification must follow the database check`);
}
const monitoringStepStart = cloudWorkflow.indexOf("      - name: Run scheduled monitoring");
if (monitoringStepStart === -1) {
  violations.push(`${cloudWorkflowPath}: missing scheduled monitoring step`);
} else {
  const nextStepStart = cloudWorkflow.indexOf("\n      - name:", monitoringStepStart + 1);
  const monitoringStep = cloudWorkflow.slice(
    monitoringStepStart,
    nextStepStart === -1 ? undefined : nextStepStart,
  );
  for (const required of ["!cancelled()", "steps.database_config.outcome == 'success'"]) {
    if (monitoringStep.includes(required)) continue;
    violations.push(
      `${cloudWorkflowPath}: scheduled monitoring missing source-isolation gate ${required}`,
    );
  }
}
if (
  monitoringStepStart !== -1 &&
  documentVerificationStart !== -1 &&
  monitoringStepStart > documentVerificationStart
) {
  violations.push(`${cloudWorkflowPath}: scheduled monitoring must run before PDF verification`);
}
if (!cloudWorkflow.includes("DATABASE_URL: ${{ secrets.DATABASE_URL }}")) {
  violations.push(`${cloudWorkflowPath}: verification must use the cloud database`);
}
for (const token of ["OPENAI_API_KEY", "OCULIS_SUMMARY_MODEL"]) {
  if (cloudWorkflow.includes(token)) {
    violations.push(`${cloudWorkflowPath}: ${token} must not be sent to scheduled ingestion`);
  }
}

const lockfile = await readFile(new URL("package-lock.json", root), "utf8");
for (const token of ["@anthropic-ai/sdk", "anthropic-ai-sdk"]) {
  if (lockfile.includes(token)) violations.push(`package-lock.json: ${token}`);
}

const envExample = await readFile(new URL(".env.example", root), "utf8");
for (const token of [
  "ANTHROPIC_API_KEY",
  "OCULIS_USE_CLAUDE",
  "NEXT_PUBLIC_OPENAI_API_KEY",
  "OPENAI_API_KEY",
  "OCULIS_SUMMARY_MODEL",
]) {
  if (envExample.includes(token)) violations.push(`.env.example: ${token}`);
}

for (const [path, tokens] of Object.entries({
  "packages/db/src/schema.ts": ["documentSummaries", '"document_summaries"'],
  "packages/db/src/client.ts": ["CREATE TABLE IF NOT EXISTS document_summaries"],
  "packages/db/src/repository.ts": [
    "listDocumentSummaries",
    "storeDocumentSummary",
    "reviewDocumentSummary",
  ],
  "apps/web/src/lib/data.ts": ["summaryEligible", "listDocumentSummaries"],
})) {
  const body = await readFile(new URL(path, root), "utf8");
  for (const token of tokens) {
    if (body.includes(token))
      violations.push(`${path}: removed summary feature returned: ${token}`);
  }
}

if (violations.length) {
  console.error("Factual-data policy violations:\n" + violations.map((v) => `- ${v}`).join("\n"));
  process.exit(1);
}

console.log("Factual-data policy: OK");

/**
 * Publish a bounded editorial review file containing exact Spanish initiative titles
 * and their manually verified English translations.
 *
 * Automatic model output deliberately cannot use this path. The operator must name
 * the reviewer and provide the explicit confirmation flag after comparing every row
 * against its current official title.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createDb,
  getInitiativeById,
  REVIEWED_INITIATIVE_TITLE_MODEL_PREFIX,
  storeInitiativeTitleTranslation,
} from "@oculis/db";
import {
  hashExactInitiativeTitle,
  repairInitiativeTitleLeadingZeroIntegers,
  validateInitiativeTitleNumericIntegrity,
  validateTranslatedInitiativeTitle,
} from "./translate-initiative-titles.js";
import { loadEnv } from "./env.js";

const REVIEW_CONFIRMATION_FLAG = "--confirm-reviewed-against-official-title";
const MAX_REVIEWED_ROWS = 250;

interface ReviewedInitiativeTitleInput {
  id: number;
  code: string;
  sourceTitle: string;
  translatedTitle: string;
}

function requiredStringArg(argv: readonly string[], name: string): string {
  const flag = `--${name}`;
  const inline = `${flag}=`;
  const matches = argv
    .map((token, index) => ({ token, index }))
    .filter(({ token }) => token === flag || token.startsWith(inline));
  if (matches.length !== 1) throw new Error(`${flag} is required exactly once`);
  const match = matches[0]!;
  const value = match.token === flag ? argv[match.index + 1] : match.token.slice(inline.length);
  if (!value || (match.token === flag && value.startsWith("--"))) {
    throw new Error(`${flag} requires a non-empty value`);
  }
  return value.trim();
}

function parseReviewFile(value: unknown): ReviewedInitiativeTitleInput[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_REVIEWED_ROWS) {
    throw new Error(`review file must contain 1-${MAX_REVIEWED_ROWS} rows`);
  }
  const seen = new Set<number>();
  return value.map((candidate, index) => {
    if (typeof candidate !== "object" || candidate === null) {
      throw new Error(`review row ${index + 1} must be an object`);
    }
    const row = candidate as Record<string, unknown>;
    if (!Number.isSafeInteger(row.id) || (row.id as number) <= 0) {
      throw new Error(`review row ${index + 1} has an invalid initiative id`);
    }
    if (seen.has(row.id as number)) throw new Error(`duplicate initiative id ${row.id}`);
    seen.add(row.id as number);
    for (const field of ["code", "sourceTitle", "translatedTitle"] as const) {
      if (typeof row[field] !== "string" || !row[field].trim()) {
        throw new Error(`review row ${index + 1} has an invalid ${field}`);
      }
    }
    return {
      id: row.id as number,
      code: row.code as string,
      sourceTitle: row.sourceTitle as string,
      translatedTitle: row.translatedTitle as string,
    };
  });
}

async function main(): Promise<void> {
  loadEnv();
  if (!process.argv.includes(REVIEW_CONFIRMATION_FLAG)) {
    throw new Error(
      `${REVIEW_CONFIRMATION_FLAG} is required after editorial comparison of every row`,
    );
  }
  const file = resolve(requiredStringArg(process.argv, "file"));
  const reviewer = requiredStringArg(process.argv, "reviewer");
  const batch = requiredStringArg(process.argv, "batch");
  if (reviewer.length > 100 || batch.length > 100) {
    throw new Error("reviewer and batch must be at most 100 characters");
  }
  const model =
    `${REVIEWED_INITIATIVE_TITLE_MODEL_PREFIX}v1/` +
    `${encodeURIComponent(reviewer)}/${encodeURIComponent(batch)}`;
  const rows = parseReviewFile(JSON.parse(await readFile(file, "utf8")));

  const handle = createDb();
  try {
    await handle.ensureSchema();
    const validated: ReviewedInitiativeTitleInput[] = [];
    for (const row of rows) {
      const current = await getInitiativeById(handle.db, row.id);
      if (!current || current.code !== row.code || current.title !== row.sourceTitle) {
        throw new Error(`initiative ${row.id} no longer matches its reviewed code/title`);
      }
      const translatedTitle = validateInitiativeTitleNumericIntegrity(
        row.sourceTitle,
        repairInitiativeTitleLeadingZeroIntegers(
          row.sourceTitle,
          validateTranslatedInitiativeTitle(row.translatedTitle),
        ),
      );
      validated.push({ ...row, translatedTitle });
    }

    let published = 0;
    let unchanged = 0;
    for (const row of validated) {
      const stored = await storeInitiativeTitleTranslation(handle.db, {
        initiativeId: row.id,
        sourceTitle: row.sourceTitle,
        sourceTitleHash: hashExactInitiativeTitle(row.sourceTitle),
        translatedTitle: row.translatedTitle,
        model,
      });
      if (!stored) throw new Error(`initiative ${row.id} changed during publication`);
      if (stored.inserted) published++;
      else unchanged++;
    }
    console.log(
      JSON.stringify({ reviewer, batch, model, reviewed: rows.length, published, unchanged }),
    );
  } finally {
    await handle.close();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

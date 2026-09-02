/**
 * Explicit, server-only Spanish -> English initiative-title translation command.
 *
 * This module is deliberately disconnected from `src/index.ts`, `daily.ts`, every
 * ingestion path, and the web application. The model runtime is dynamically imported
 * only by the CLI after the database candidates have been selected; importing this
 * module in tests never loads a model or accesses the network.
 */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createDb,
  listInitiativeTitleTranslationCandidates,
  listRecentDepositedInitiativesByProvince,
  storeInitiativeTitleTranslation,
  type Database,
  type InitiativeTitleTranslationCandidate,
} from "@oculis/db";
import { numericArg } from "./cli.js";
import { loadEnv } from "./env.js";

export const INITIATIVE_TITLE_TRANSLATION_MODEL = "Xenova/nllb-200-distilled-600M";
export const INITIATIVE_TITLE_TRANSLATION_REVISION = "261c31d1a5732c67cdd16d80e8d6088507c7ccea";
export const INITIATIVE_TITLE_TRANSLATION_PIPELINE_VERSION = "v4";
export const INITIATIVE_TITLE_TRANSLATION_PROVENANCE =
  `${INITIATIVE_TITLE_TRANSLATION_MODEL}@${INITIATIVE_TITLE_TRANSLATION_REVISION}` +
  `#oculis-title-translation-${INITIATIVE_TITLE_TRANSLATION_PIPELINE_VERSION}`;
export const INITIATIVE_TITLE_TRANSLATION_RUNTIME = "@huggingface/transformers@3.8.1";
export const INITIATIVE_TITLE_TRANSLATION_TARGET_LOCALE = "en" as const;
export const DEFAULT_INITIATIVE_TITLE_TRANSLATION_LIMIT = 25;
export const MAX_INITIATIVE_TITLE_TRANSLATION_LIMIT = 100;
export const MAX_SOURCE_TITLE_CHARACTERS = 2_000;
export const MAX_TRANSLATED_TITLE_CHARACTERS = 4_000;
export const MAX_TRANSLATED_TITLE_TOKENS = 256;
// Seq2seq models can truncate dense legal clauses before their nominal token ceiling.
// Keep each source fragment deliberately short so names, acronyms, amounts, and the
// final clause all reach the model and can pass the placeholder integrity gate.
export const MAX_PROTECTED_TITLE_CHUNK_CHARACTERS = 180;
export const HOME_INITIATIVES_PER_PROVINCE = 5;

const PLACEHOLDER_PREFIX = "ZXQACR";
const PLACEHOLDER_SUFFIX = "ZXQ";
const PLACEHOLDER_PATTERN = /ZXQACR\d+ZXQ/gu;
const EXACT_PLACEHOLDER_PATTERN = /^ZXQACR\d+ZXQ$/u;
const ALL_UPPERCASE_TITLE_ACRONYMS = new Set(["ARS", "UTECT", "IDAC", "PDL"]);

export const DOMINICAN_PROVINCE_NAMES = [
  "Distrito Nacional",
  "Santo Domingo",
  "Santiago",
  "La Vega",
  "San Cristóbal",
  "Puerto Plata",
  "Duarte",
  "La Altagracia",
  "San Pedro de Macorís",
  "Espaillat",
  "Azua",
  "Barahona",
  "Monte Plata",
  "Peravia",
  "Valverde",
  "Sánchez Ramírez",
  "María Trinidad Sánchez",
  "Monseñor Nouel",
  "La Romana",
  "Hermanas Mirabal",
  "Samaná",
  "Baoruco",
  "Independencia",
  "Dajabón",
  "Elías Piña",
  "San Juan",
  "Santiago Rodríguez",
  "Monte Cristi",
  "El Seibo",
  "Hato Mayor",
  "San José de Ocoa",
  "Pedernales",
] as const;

export const DOMINICAN_PROVINCE_SOURCE_ALIASES = [
  "Montecristi",
  "Bahoruco",
  "Santo Domingo de Guzmán",
] as const;

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const DOMINICAN_PROVINCE_LITERAL_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${[...DOMINICAN_PROVINCE_NAMES, ...DOMINICAN_PROVINCE_SOURCE_ALIASES]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegularExpression)
    .join("|")})(?![\\p{L}\\p{N}])`,
  "gu",
);

export class InitiativeTitleTranslationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "InitiativeTitleTranslationError";
  }
}

function hasUnsafeTitleControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x00ad ||
      codePoint === 0x061c ||
      codePoint === 0x180e ||
      (codePoint >= 0x200b && codePoint <= 0x200f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2060 && codePoint <= 0x206f) ||
      codePoint === 0xfeff ||
      (codePoint >= 0xe0000 && codePoint <= 0xe007f)
    ) {
      return true;
    }
  }
  return false;
}

export function validateSourceInitiativeTitle(value: unknown): string {
  if (typeof value !== "string") {
    throw new InitiativeTitleTranslationError(
      "INVALID_SOURCE_TITLE",
      "El título oficial recibido no es texto.",
    );
  }
  if (!value.trim()) {
    throw new InitiativeTitleTranslationError(
      "EMPTY_SOURCE_TITLE",
      "El título oficial está vacío.",
    );
  }
  if (/(?:\.\.\.|…)\s*$/u.test(value)) {
    throw new InitiativeTitleTranslationError(
      "INCOMPLETE_SOURCE_TITLE",
      "El título oficial está truncado; debe esperar la ficha verificada de la fuente.",
    );
  }
  if (value.length > MAX_SOURCE_TITLE_CHARACTERS) {
    throw new InitiativeTitleTranslationError(
      "SOURCE_TITLE_TOO_LARGE",
      `El título oficial excede ${MAX_SOURCE_TITLE_CHARACTERS} caracteres.`,
    );
  }
  if (hasUnsafeTitleControl(value)) {
    throw new InitiativeTitleTranslationError(
      "UNSAFE_SOURCE_TITLE_CONTROLS",
      "El título oficial contiene controles invisibles o de terminal no permitidos.",
    );
  }
  return value;
}

export function validateTranslatedInitiativeTitle(value: unknown): string {
  if (typeof value !== "string") {
    throw new InitiativeTitleTranslationError(
      "INVALID_TRANSLATION_OUTPUT",
      "La traducción recibida no es texto.",
    );
  }
  if (hasUnsafeTitleControl(value)) {
    throw new InitiativeTitleTranslationError(
      "UNSAFE_TRANSLATION_CONTROLS",
      "La traducción contiene controles invisibles o de terminal no permitidos.",
    );
  }
  const translatedTitle = value.trim();
  if (!translatedTitle) {
    throw new InitiativeTitleTranslationError(
      "EMPTY_TRANSLATION_OUTPUT",
      "La traducción recibida está vacía.",
    );
  }
  if (translatedTitle.length > MAX_TRANSLATED_TITLE_CHARACTERS) {
    throw new InitiativeTitleTranslationError(
      "TRANSLATION_OUTPUT_TOO_LARGE",
      `La traducción excede ${MAX_TRANSLATED_TITLE_CHARACTERS} caracteres.`,
    );
  }
  return translatedTitle;
}

const NUMERIC_INTEGRITY_TOKEN_PATTERN =
  /(?:[$€£¥₱₽₹₩₡₲]\s*)?[+-]?\p{N}+(?:[.,/:'-]\p{N}+)*(?:\s*[%‰])?/gu;

interface NumericIntegrityTokenSpan {
  token: string;
  start: number;
  end: number;
}

function initiativeTitleNumericIntegrityTokenSpans(value: string): NumericIntegrityTokenSpan[] {
  return [...value.matchAll(NUMERIC_INTEGRITY_TOKEN_PATTERN)].map((match) => ({
    token: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
}

/** Exact ordered numeric/currency literals used by the fail-closed translation gate. */
export function initiativeTitleNumericIntegrityTokens(value: string): string[] {
  return initiativeTitleNumericIntegrityTokenSpans(value).map(({ token }) => token);
}

const ATTACHED_NUMERIC_IDENTIFIER_CHARACTER =
  /[\p{L}\p{M}\p{N}\p{Pc}\p{Pd}\p{Sc}\p{Sm}#§°%‰‱+\-/:\x27’‘ʼ]/u;
const LEADING_DECIMAL_SEPARATOR_CHARACTER = /[.,]/u;
const TRAILING_ORDINAL_OR_DEGREE_PATTERN = /^(?:[.,]\s*)?[ºª°]/u;

function hasPlainUnsignedIntegerBoundaries(
  value: string,
  span: NumericIntegrityTokenSpan,
  end = span.end,
): boolean {
  const beforeCharacters = Array.from(value.slice(0, span.start));
  const before = beforeCharacters[beforeCharacters.length - 1] ?? "";
  const after = Array.from(value.slice(end))[0] ?? "";
  return (
    (!before || !ATTACHED_NUMERIC_IDENTIFIER_CHARACTER.test(before)) &&
    (!before || !LEADING_DECIMAL_SEPARATOR_CHARACTER.test(before)) &&
    (!after || !ATTACHED_NUMERIC_IDENTIFIER_CHARACTER.test(after)) &&
    !TRAILING_ORDINAL_OR_DEGREE_PATTERN.test(value.slice(end))
  );
}

function isPlainUnsignedIntegerSpan(value: string, span: NumericIntegrityTokenSpan): boolean {
  if (!/^[0-9]+$/.test(span.token)) return false;
  return hasPlainUnsignedIntegerBoundaries(value, span);
}

function expectedEnglishOrdinalSuffix(canonicalInteger: string): "st" | "nd" | "rd" | "th" {
  const lastTwo = canonicalInteger.slice(-2);
  if (lastTwo === "11" || lastTwo === "12" || lastTwo === "13") return "th";
  if (canonicalInteger.endsWith("1")) return "st";
  if (canonicalInteger.endsWith("2")) return "nd";
  if (canonicalInteger.endsWith("3")) return "rd";
  return "th";
}

/** End offset to replace, including a valid attached English ordinal when present. */
function translatedLeadingZeroRepairEnd(
  value: string,
  span: NumericIntegrityTokenSpan,
): number | null {
  if (!/^(?:0|[1-9][0-9]*)$/.test(span.token)) return null;
  const ordinal = value.slice(span.end).match(/^(st|nd|rd|th)/i);
  if (!ordinal) return hasPlainUnsignedIntegerBoundaries(value, span) ? span.end : null;
  const suffix = ordinal[1]!.toLowerCase();
  if (suffix !== expectedEnglishOrdinalSuffix(span.token)) return null;
  const end = span.end + ordinal[0].length;
  return hasPlainUnsignedIntegerBoundaries(value, span, end) ? end : null;
}

/**
 * Restore a dropped leading zero only when every numeric token still aligns safely.
 *
 * The repair is all-or-nothing. Token counts must match, all other pairs must already
 * be exact, and each mismatch must be a standalone source integer with leading zeroes
 * whose output is its canonical unsigned value, optionally followed by its correct
 * English ordinal suffix. Composite dates, signs, currency, separators, identifiers,
 * additions, deletions, and reordering are untouched so the strict gate rejects them.
 */
export function repairInitiativeTitleLeadingZeroIntegers(
  exactSourceTitle: string,
  translatedAndRestoredTitle: string,
): string {
  const sourceSpans = initiativeTitleNumericIntegrityTokenSpans(exactSourceTitle);
  const translatedSpans = initiativeTitleNumericIntegrityTokenSpans(translatedAndRestoredTitle);
  if (sourceSpans.length !== translatedSpans.length) return translatedAndRestoredTitle;

  const repairs: Array<{ start: number; end: number; sourceToken: string }> = [];
  for (let index = 0; index < sourceSpans.length; index++) {
    const source = sourceSpans[index]!;
    const translated = translatedSpans[index]!;
    if (source.token === translated.token) continue;
    const sourceCanonical = source.token.replace(/^0+(?=[0-9])/, "");
    const translatedRepairEnd = translatedLeadingZeroRepairEnd(
      translatedAndRestoredTitle,
      translated,
    );
    if (
      !/^0[0-9]+$/.test(source.token) ||
      sourceCanonical !== translated.token ||
      !isPlainUnsignedIntegerSpan(exactSourceTitle, source) ||
      translatedRepairEnd === null
    ) {
      return translatedAndRestoredTitle;
    }
    repairs.push({
      start: translated.start,
      end: translatedRepairEnd,
      sourceToken: source.token,
    });
  }

  let repaired = translatedAndRestoredTitle;
  for (const repair of repairs.reverse()) {
    repaired = repaired.slice(0, repair.start) + repair.sourceToken + repaired.slice(repair.end);
  }
  return repaired;
}

/**
 * Require every numeric literal and its formatting to survive translation exactly.
 *
 * This intentionally does not interpret number words such as `tres`/`three`: only
 * literal digits, their separators, signs, currency markers, and percent suffixes are
 * compared. Any missing, added, reordered, or reformatted numeric token fails closed.
 */
export function validateInitiativeTitleNumericIntegrity(
  exactSourceTitle: string,
  translatedAndRestoredTitle: string,
): string {
  const sourceTokens = initiativeTitleNumericIntegrityTokens(exactSourceTitle);
  const translatedTokens = initiativeTitleNumericIntegrityTokens(translatedAndRestoredTitle);
  if (
    sourceTokens.length !== translatedTokens.length ||
    sourceTokens.some((token, index) => token !== translatedTokens[index])
  ) {
    throw new InitiativeTitleTranslationError(
      "NUMERIC_INTEGRITY_MISMATCH",
      `La traducción alteró los literales numéricos: fuente=${JSON.stringify(sourceTokens)} ` +
        `traducción=${JSON.stringify(translatedTokens)}.`,
    );
  }
  return translatedAndRestoredTitle;
}

export function hashExactInitiativeTitle(sourceTitle: string): string {
  return createHash("sha256").update(sourceTitle, "utf8").digest("hex");
}

export interface ProtectedInitiativeTitle {
  text: string;
  replacements: ReadonlyArray<{ placeholder: string; original: string }>;
}

/**
 * Replace exact province names and source-literal acronyms with neutral tokens.
 *
 * Province literals are protected first, longest name first, so a compound name cannot
 * be partially matched. Each occurrence then gets its own placeholder so repeated
 * literals and their exact ordering are auditable. The acronym pass explicitly ignores
 * those placeholders rather than protecting them a second time.
 */
export function protectInitiativeTitleAcronyms(sourceTitle: string): ProtectedInitiativeTitle {
  if (PLACEHOLDER_PATTERN.test(sourceTitle)) {
    PLACEHOLDER_PATTERN.lastIndex = 0;
    throw new InitiativeTitleTranslationError(
      "SOURCE_PLACEHOLDER_COLLISION",
      "El título oficial contiene un marcador reservado para proteger nombres y siglas.",
    );
  }
  PLACEHOLDER_PATTERN.lastIndex = 0;

  const replacements: Array<{ placeholder: string; original: string }> = [];
  const isAllUppercaseTitle = /\p{Lu}/u.test(sourceTitle) && !/\p{Ll}/u.test(sourceTitle);
  let protectedText = sourceTitle.replace(DOMINICAN_PROVINCE_LITERAL_PATTERN, (original) => {
    const placeholder = `${PLACEHOLDER_PREFIX}${replacements.length}${PLACEHOLDER_SUFFIX}`;
    replacements.push({ placeholder, original });
    return placeholder;
  });
  // Unicode title boundaries matter for Spanish text: \b is ASCII-centric and would
  // mis-detect tokens beside Ñ or accented letters. In mixed/title-case text every
  // 2-12 character uppercase/alphanumeric token is acronym-like. Senate frequently
  // publishes entire titles in uppercase, however, so that context protects only a
  // conservative explicit acronym set or alphanumeric tokens containing both an
  // uppercase letter and a digit; ordinary words and pure numbers must remain visible
  // to the translator.
  protectedText = protectedText.replace(
    /(?<![\p{L}\p{N}])[\p{Lu}\p{N}]{2,12}(?![\p{L}\p{N}])/gu,
    (original) => {
      if (EXACT_PLACEHOLDER_PATTERN.test(original)) return original;
      // Dates, years, monetary amounts, article numbers, and other numeric facts are
      // safest left as literal model input. The acronym guard is only for institutional
      // tokens containing at least one uppercase letter.
      if (!/\p{Lu}/u.test(original)) return original;
      if (
        isAllUppercaseTitle &&
        !/\p{N}/u.test(original) &&
        !ALL_UPPERCASE_TITLE_ACRONYMS.has(original)
      ) {
        return original;
      }
      const placeholder = `${PLACEHOLDER_PREFIX}${replacements.length}${PLACEHOLDER_SUFFIX}`;
      replacements.push({ placeholder, original });
      return placeholder;
    },
  );
  return { text: protectedText, replacements };
}

function occurrences(value: string, needle: string): number {
  let count = 0;
  let cursor = 0;
  while (true) {
    const index = value.indexOf(needle, cursor);
    if (index < 0) return count;
    count++;
    cursor = index + needle.length;
  }
}

export function restoreInitiativeTitleAcronyms(
  translatedTitle: string,
  replacements: ProtectedInitiativeTitle["replacements"],
): string {
  const expected = new Set(replacements.map(({ placeholder }) => placeholder));
  const returned = translatedTitle.match(PLACEHOLDER_PATTERN) ?? [];
  if (returned.some((placeholder) => !expected.has(placeholder))) {
    throw new InitiativeTitleTranslationError(
      "UNEXPECTED_ACRONYM_PLACEHOLDER",
      "El modelo devolvió un marcador de literal protegido no solicitado.",
    );
  }

  let restored = translatedTitle;
  for (const { placeholder, original } of replacements) {
    if (occurrences(restored, placeholder) !== 1) {
      throw new InitiativeTitleTranslationError(
        "MUTATED_ACRONYM_PLACEHOLDER",
        `El modelo no conservó exactamente una vez el marcador protegido ${placeholder}.`,
      );
    }
    restored = restored.replace(placeholder, original);
  }
  if (PLACEHOLDER_PATTERN.test(restored)) {
    PLACEHOLDER_PATTERN.lastIndex = 0;
    throw new InitiativeTitleTranslationError(
      "UNRESTORED_ACRONYM_PLACEHOLDER",
      "La traducción conserva un marcador de sigla sin restaurar.",
    );
  }
  PLACEHOLDER_PATTERN.lastIndex = 0;
  return restored;
}

const PREFERRED_CHUNK_PUNCTUATION = /[.!?;:,…][)\]}'"»”]*$/u;

function isWhitespace(character: string): boolean {
  return /\s/u.test(character);
}

/**
 * Split protected model input at visible linguistic boundaries without losing text.
 *
 * Punctuation immediately followed by whitespace is preferred; otherwise the last
 * whitespace within the bound is used. A single token longer than the bound remains
 * intact instead of being truncated or cut through an acronym placeholder. Joining
 * the returned chunks with one space reconstructs a normally-spaced input exactly.
 */
export function chunkProtectedInitiativeTitle(
  protectedTitle: string,
  maxCharacters = MAX_PROTECTED_TITLE_CHUNK_CHARACTERS,
): string[] {
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1) {
    throw new Error("maxCharacters must be a positive integer");
  }
  if (protectedTitle.length <= maxCharacters) return [protectedTitle];

  const chunks: string[] = [];
  let start = 0;
  while (start < protectedTitle.length) {
    while (start < protectedTitle.length && isWhitespace(protectedTitle[start]!)) start++;
    if (start >= protectedTitle.length) break;
    if (protectedTitle.length - start <= maxCharacters) {
      chunks.push(protectedTitle.slice(start).trimEnd());
      break;
    }

    const boundedEnd = Math.min(start + maxCharacters, protectedTitle.length - 1);
    let lastWhitespace = -1;
    let lastPunctuation = -1;
    for (let index = start + 1; index <= boundedEnd; index++) {
      if (!isWhitespace(protectedTitle[index]!)) continue;
      // Only the first character of a whitespace run is a split boundary.
      if (isWhitespace(protectedTitle[index - 1]!)) continue;
      lastWhitespace = index;
      if (PREFERRED_CHUNK_PUNCTUATION.test(protectedTitle.slice(start, index).trimEnd())) {
        lastPunctuation = index;
      }
    }

    let splitAt = lastPunctuation >= 0 ? lastPunctuation : lastWhitespace;
    if (splitAt < 0) {
      // The bounded prefix is one indivisible token. Find its next whitespace and
      // permit that chunk to exceed the soft bound rather than splitting the token.
      splitAt = boundedEnd + 1;
      while (splitAt < protectedTitle.length && !isWhitespace(protectedTitle[splitAt]!)) {
        splitAt++;
      }
      if (splitAt >= protectedTitle.length) {
        chunks.push(protectedTitle.slice(start).trimEnd());
        break;
      }
    }

    const chunk = protectedTitle.slice(start, splitAt).trimEnd();
    if (chunk) chunks.push(chunk);
    start = splitAt;
  }
  return chunks;
}

const SPANISH_CONJUNCTION_WITH_SPACES_PATTERN = / (?:y|e|o|u|ni) /giu;

interface PlaceholderSpan {
  start: number;
  end: number;
}

function protectedPlaceholderSpans(value: string): PlaceholderSpan[] {
  return [...value.matchAll(PLACEHOLDER_PATTERN)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

/**
 * Isolate adjacent protected literals at a Spanish coordinating conjunction.
 *
 * A boundary is eligible only when it occurs between two adjacent placeholders. The
 * conjunction starts the right-hand chunk, so joining the results with one space
 * recreates the input byte-for-byte. Multiple or non-ASCII whitespace is deliberately
 * not rewritten: that input remains one chunk and fails closed if its markers mutate.
 */
export function splitProtectedChunkAtSpanishConjunctions(protectedChunk: string): string[] {
  const placeholders = protectedPlaceholderSpans(protectedChunk);
  if (placeholders.length < 2) return [protectedChunk];

  const conjunctionStarts: number[] = [];
  for (let index = 0; index < placeholders.length - 1; index++) {
    const left = placeholders[index]!;
    const right = placeholders[index + 1]!;
    const between = protectedChunk.slice(left.end, right.start);
    const conjunctions = [...between.matchAll(SPANISH_CONJUNCTION_WITH_SPACES_PATTERN)];
    const conjunction = conjunctions[conjunctions.length - 1];
    if (!conjunction) continue;
    // The pattern starts with exactly one separator space; retain the conjunction and
    // every character after it in the right-hand chunk.
    conjunctionStarts.push(left.end + conjunction.index + 1);
  }
  if (conjunctionStarts.length === 0) return [protectedChunk];

  const chunks: string[] = [];
  let start = 0;
  for (const conjunctionStart of conjunctionStarts) {
    const delimiterSpace = conjunctionStart - 1;
    chunks.push(protectedChunk.slice(start, delimiterSpace));
    start = conjunctionStart;
  }
  chunks.push(protectedChunk.slice(start));

  if (chunks.some((chunk) => !chunk) || chunks.join(" ") !== protectedChunk) {
    throw new InitiativeTitleTranslationError(
      "UNSAFE_PLACEHOLDER_FALLBACK_SPLIT",
      "No se pudo dividir el título protegido sin perder texto.",
    );
  }
  return chunks;
}

function protectedPlaceholderMultiplicityMatches(sourceChunk: string, translatedChunk: string) {
  const source = sourceChunk.match(PLACEHOLDER_PATTERN) ?? [];
  const translated = translatedChunk.match(PLACEHOLDER_PATTERN) ?? [];
  if (source.length !== translated.length) return false;
  const remaining = new Map<string, number>();
  for (const placeholder of source) {
    remaining.set(placeholder, (remaining.get(placeholder) ?? 0) + 1);
  }
  for (const placeholder of translated) {
    const count = remaining.get(placeholder) ?? 0;
    if (count === 0) return false;
    if (count === 1) remaining.delete(placeholder);
    else remaining.set(placeholder, count - 1);
  }
  return remaining.size === 0;
}

export interface InitiativeTitleTranslationProvider {
  readonly model: string;
  translateTitle(sourceTitle: string): Promise<string>;
  dispose?(): Promise<void> | void;
}

interface TranslationPipelineOptions {
  src_lang: "spa_Latn";
  tgt_lang: "eng_Latn";
  do_sample: false;
  num_beams: 1;
  max_new_tokens: number;
}

interface TranslationPipelineLike {
  (sourceTitle: string, options: TranslationPipelineOptions): Promise<unknown>;
  dispose?: () => Promise<void>;
}

export type TranslationPipelineLoader = (
  task: "translation",
  model: string,
  options: { dtype: "q8"; revision: string },
) => Promise<TranslationPipelineLike>;

async function defaultTranslationPipelineLoader(
  task: "translation",
  model: string,
  options: { dtype: "q8"; revision: string },
): Promise<TranslationPipelineLike> {
  const { pipeline } = await import("@huggingface/transformers");
  return (await pipeline(task, model, options)) as unknown as TranslationPipelineLike;
}

function translationTextFromPipelineOutput(output: unknown): string {
  if (!Array.isArray(output) || output.length !== 1) {
    throw new InitiativeTitleTranslationError(
      "INVALID_PIPELINE_OUTPUT",
      "El traductor local no devolvió exactamente una traducción.",
    );
  }
  const first: unknown = output[0];
  if (
    typeof first !== "object" ||
    first === null ||
    !("translation_text" in first) ||
    typeof first.translation_text !== "string"
  ) {
    throw new InitiativeTitleTranslationError(
      "INVALID_PIPELINE_OUTPUT",
      "El traductor local devolvió una estructura inesperada.",
    );
  }
  return first.translation_text;
}

/** Load exactly one revision-pinned quantized NLLB pipeline for the whole CLI run. */
export async function createOfflineInitiativeTitleTranslationProvider(
  loadPipeline: TranslationPipelineLoader = defaultTranslationPipelineLoader,
): Promise<InitiativeTitleTranslationProvider> {
  const translator = await loadPipeline("translation", INITIATIVE_TITLE_TRANSLATION_MODEL, {
    dtype: "q8",
    revision: INITIATIVE_TITLE_TRANSLATION_REVISION,
  });
  const generationOptions: TranslationPipelineOptions = {
    src_lang: "spa_Latn",
    tgt_lang: "eng_Latn",
    do_sample: false,
    num_beams: 1,
    max_new_tokens: MAX_TRANSLATED_TITLE_TOKENS,
  };
  async function translateChunk(chunk: string): Promise<string> {
    return translationTextFromPipelineOutput(await translator(chunk, generationOptions));
  }
  return {
    model: INITIATIVE_TITLE_TRANSLATION_PROVENANCE,
    async translateTitle(sourceTitle) {
      const chunks = chunkProtectedInitiativeTitle(sourceTitle);
      const translatedChunks: string[] = [];
      for (const chunk of chunks) {
        const translatedChunk = await translateChunk(chunk);
        // Preserve the pre-chunking behavior exactly for short titles. Long titles
        // validate each part independently so one empty/truncated call cannot vanish
        // inside an otherwise nonempty concatenated result.
        const validatedChunk =
          chunks.length === 1
            ? translatedChunk
            : validateTranslatedInitiativeTitle(translatedChunk);
        if (protectedPlaceholderMultiplicityMatches(chunk, validatedChunk)) {
          translatedChunks.push(validatedChunk);
          continue;
        }

        const fallbackChunks = splitProtectedChunkAtSpanishConjunctions(chunk);
        if (fallbackChunks.length === 1) {
          translatedChunks.push(validatedChunk);
          continue;
        }

        const fallbackTranslations: string[] = [];
        for (const fallbackChunk of fallbackChunks) {
          fallbackTranslations.push(
            validateTranslatedInitiativeTitle(await translateChunk(fallbackChunk)),
          );
        }
        translatedChunks.push(fallbackTranslations.join(" "));
      }
      return translatedChunks.join(" ");
    },
    async dispose() {
      await translator.dispose?.();
    },
  };
}

export interface InitiativeTitleTranslationBatchOptions {
  provider: InitiativeTitleTranslationProvider;
  initiativeIds?: readonly number[];
  home?: boolean;
  all?: boolean;
  limit?: number;
  log?: (message: string) => void;
}

export interface InitiativeTitleTranslationBatchResult {
  candidates: number;
  translated: number;
  skipped: number;
  failed: number;
  failures: Array<{ initiativeId: number; error: string }>;
}

function boundedBatchLimit(value = DEFAULT_INITIATIVE_TITLE_TRANSLATION_LIMIT): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_INITIATIVE_TITLE_TRANSLATION_LIMIT) {
    throw new Error(
      `limit must be an integer between 1 and ${MAX_INITIATIVE_TITLE_TRANSLATION_LIMIT}`,
    );
  }
  return value;
}

async function homeInitiativeIds(db: Database): Promise<number[]> {
  const rows = await listRecentDepositedInitiativesByProvince(db, HOME_INITIATIVES_PER_PROVINCE);
  return [...new Set(rows.map(({ id }) => id))];
}

/**
 * Translate a bounded selection (or the explicit full backlog) sequentially.
 *
 * The exact source title is hashed before acronym substitution. A failed model result
 * never reaches persistence, and an idempotent conflict is reported as a skip.
 */
export async function runInitiativeTitleTranslationBatch(
  db: Database,
  opts: InitiativeTitleTranslationBatchOptions,
): Promise<InitiativeTitleTranslationBatchResult> {
  const log = opts.log ?? (() => {});
  const limit = boundedBatchLimit(opts.limit);
  if (!opts.provider.model.trim()) throw new Error("Translation provider model is required");
  if (opts.home && opts.initiativeIds?.length) {
    throw new Error("Use home or initiativeIds, not both");
  }
  if (opts.all && (opts.home || opts.initiativeIds?.length)) {
    throw new Error("all cannot be combined with home or initiativeIds");
  }

  const initiativeIds = opts.home ? await homeInitiativeIds(db) : opts.initiativeIds;
  const exhaustSelection = opts.all || opts.home || Boolean(initiativeIds?.length);
  const failures: Array<{ initiativeId: number; error: string }> = [];
  let candidateCount = 0;
  let translated = 0;
  let skipped = 0;
  let beforeId: number | undefined;

  do {
    const page: InitiativeTitleTranslationCandidate[] =
      await listInitiativeTitleTranslationCandidates(db, {
        targetLocale: INITIATIVE_TITLE_TRANSLATION_TARGET_LOCALE,
        model: opts.provider.model,
        initiativeIds,
        beforeId,
        limit,
      });
    if (page.length === 0) break;
    candidateCount += page.length;

    for (const candidate of page) {
      try {
        const sourceTitle = validateSourceInitiativeTitle(candidate.sourceTitle);
        const sourceTitleHash = hashExactInitiativeTitle(sourceTitle);
        if (sourceTitleHash !== candidate.sourceTitleHash) {
          throw new InitiativeTitleTranslationError(
            "CANDIDATE_SOURCE_HASH_MISMATCH",
            "El SHA-256 del candidato no coincide con el título oficial exacto.",
          );
        }
        if (
          candidate.targetLocale !== INITIATIVE_TITLE_TRANSLATION_TARGET_LOCALE ||
          candidate.model !== opts.provider.model
        ) {
          throw new InitiativeTitleTranslationError(
            "CANDIDATE_PROVENANCE_MISMATCH",
            "La procedencia del candidato no coincide con el traductor solicitado.",
          );
        }
        const protectedTitle = protectInitiativeTitleAcronyms(sourceTitle);
        const providerOutput = await opts.provider.translateTitle(protectedTitle.text);
        const validatedProviderOutput = validateTranslatedInitiativeTitle(
          restoreInitiativeTitleAcronyms(providerOutput, protectedTitle.replacements),
        );
        const translatedTitle = validateInitiativeTitleNumericIntegrity(
          sourceTitle,
          repairInitiativeTitleLeadingZeroIntegers(sourceTitle, validatedProviderOutput),
        );
        const stored = await storeInitiativeTitleTranslation(db, {
          initiativeId: candidate.initiativeId,
          sourceTitle,
          sourceTitleHash,
          targetLocale: INITIATIVE_TITLE_TRANSLATION_TARGET_LOCALE,
          translatedTitle,
          model: opts.provider.model,
        });
        if (stored?.inserted) {
          translated++;
          log(`  ✔ iniciativa ${candidate.initiativeId}: traducción guardada`);
        } else {
          skipped++;
          log(
            stored
              ? `  ↷ iniciativa ${candidate.initiativeId}: traducción idéntica ya existe`
              : `  ↷ iniciativa ${candidate.initiativeId}: el título cambió durante la traducción`,
          );
        }
      } catch (cause) {
        const error = cause instanceof Error ? cause.message : String(cause);
        failures.push({ initiativeId: candidate.initiativeId, error });
        log(`  ✖ iniciativa ${candidate.initiativeId}: ${error}`);
      }
    }

    beforeId = page.at(-1)!.initiativeId;
    if (!exhaustSelection || page.length < limit) break;
  } while (exhaustSelection && beforeId !== undefined);

  return {
    candidates: candidateCount,
    translated,
    skipped,
    failed: failures.length,
    failures,
  };
}

/** Accept repeatable and comma-separated --initiative-id values, then deduplicate. */
export function parseInitiativeTitleIds(argv: readonly string[]): number[] {
  const values: number[] = [];
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    let raw: string | undefined;
    if (token === "--initiative-id") {
      raw = argv[index + 1];
      if (raw === undefined || raw.startsWith("--")) {
        throw new Error("--initiative-id requires one or more positive integer IDs");
      }
      index++;
    } else if (token.startsWith("--initiative-id=")) {
      raw = token.slice("--initiative-id=".length);
    } else {
      continue;
    }
    const pieces = raw.split(",");
    if (pieces.length === 0 || pieces.some((piece) => !/^[1-9]\d*$/.test(piece))) {
      throw new Error(`--initiative-id contains an invalid positive integer list: ${raw}`);
    }
    for (const piece of pieces) {
      const id = Number(piece);
      if (!Number.isSafeInteger(id)) {
        throw new Error(`--initiative-id is outside the safe integer range: ${piece}`);
      }
      values.push(id);
    }
  }
  return [...new Set(values)];
}

function printUsage(): void {
  console.log(`Uso:
  npm run translate-initiative-titles -w @oculis/worker -- [opciones]

Opciones:
  --limit N            Máximo por lote (${DEFAULT_INITIATIVE_TITLE_TRANSLATION_LIMIT}; máximo ${MAX_INITIATIVE_TITLE_TRANSLATION_LIMIT})
  --all                Procesa toda la cola pendiente (ignora el límite total)
  --initiative-id IDS  Uno o varios IDs; repetible y/o separados por comas
  --home               Solo las iniciativas depositadas que alimentan HOME actualmente
  --help               Muestra esta ayuda

Traduce títulos oficiales de español a inglés con ${INITIATIVE_TITLE_TRANSLATION_MODEL}
en la revisión inmutable ${INITIATIVE_TITLE_TRANSLATION_REVISION} y pipeline ${INITIATIVE_TITLE_TRANSLATION_PIPELINE_VERSION}
en el worker local. El título español permanece canónico; se guarda una traducción
separada con SHA-256 del texto fuente exacto y procedencia del modelo. El runtime se
carga solo para este comando y nunca desde web, APIs, daily o ingestas.`);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  loadEnv();
  if (hasFlag("help")) {
    printUsage();
    return;
  }
  const all = hasFlag("all");
  const home = hasFlag("home");
  const initiativeIds = parseInitiativeTitleIds(process.argv);
  const limit =
    numericArg(process.argv, "limit", {
      min: 1,
      max: MAX_INITIATIVE_TITLE_TRANSLATION_LIMIT,
    }) ?? DEFAULT_INITIATIVE_TITLE_TRANSLATION_LIMIT;
  if (all && (home || initiativeIds.length)) {
    throw new Error("Use --all, --home or --initiative-id as separate selection modes");
  }
  if (home && initiativeIds.length) {
    throw new Error("Use --home or --initiative-id, not both");
  }

  const handle = createDb();
  let provider: InitiativeTitleTranslationProvider | undefined;
  try {
    await handle.ensureSchema();
    // Candidate selection happens inside the batch, before the dynamic runtime import.
    // This keeps a bad database configuration from downloading/loading model weights.
    provider = await createOfflineInitiativeTitleTranslationProvider();
    console.log("▶ Oculis · traducción manual y local de títulos de iniciativas");
    console.log(
      `  modelo=${provider.model} runtime=${INITIATIVE_TITLE_TRANSLATION_RUNTIME} ` +
        `dtype=q8 spa_Latn→eng_Latn max_new_tokens=${MAX_TRANSLATED_TITLE_TOKENS}`,
    );
    const result = await runInitiativeTitleTranslationBatch(handle.db, {
      provider,
      all,
      home,
      initiativeIds: initiativeIds.length ? initiativeIds : undefined,
      limit,
      log: (message) => console.log(message),
    });
    console.log(
      `\n${result.failed ? "⚠" : "✔"} candidatos ${result.candidates} · ` +
        `nuevos ${result.translated} · idénticos ${result.skipped} · fallidos ${result.failed}`,
    );
    if (result.failed) process.exitCode = 1;
  } finally {
    await provider?.dispose?.();
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

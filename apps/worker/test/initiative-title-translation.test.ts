import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  createDb,
  initiativeTitleTranslations,
  listInitiativeTitleTranslationCandidates,
  upsertInitiative,
  type Database,
} from "@oculis/db";
import {
  DOMINICAN_PROVINCE_NAMES,
  DOMINICAN_PROVINCE_SOURCE_ALIASES,
  INITIATIVE_TITLE_TRANSLATION_MODEL,
  INITIATIVE_TITLE_TRANSLATION_PIPELINE_VERSION,
  INITIATIVE_TITLE_TRANSLATION_PROVENANCE,
  INITIATIVE_TITLE_TRANSLATION_REVISION,
  MAX_PROTECTED_TITLE_CHUNK_CHARACTERS,
  MAX_TRANSLATED_TITLE_CHARACTERS,
  MAX_TRANSLATED_TITLE_TOKENS,
  chunkProtectedInitiativeTitle,
  createOfflineInitiativeTitleTranslationProvider,
  hashExactInitiativeTitle,
  initiativeTitleNumericIntegrityTokens,
  parseInitiativeTitleIds,
  protectInitiativeTitleAcronyms,
  repairInitiativeTitleLeadingZeroIntegers,
  restoreInitiativeTitleAcronyms,
  runInitiativeTitleTranslationBatch,
  splitProtectedChunkAtSpanishConjunctions,
  validateInitiativeTitleNumericIntegrity,
  validateSourceInitiativeTitle,
  validateTranslatedInitiativeTitle,
  type InitiativeTitleTranslationProvider,
  type TranslationPipelineLoader,
} from "../src/translate-initiative-titles.js";

const LONG_LEGAL_SOURCE_TITLE = [
  "Resolución aprobatoria del contrato de compraventa suscrito entre el Estado dominicano y el CEA el 14 de febrero de 2024, relativo a una porción de terreno destinada a la construcción de viviendas de interés social y de las obras comunitarias complementarias previstas en el expediente administrativo,",
  "representado por su director ejecutivo y por el señor Rafael A. Pérez, quien declara haber recibido los planos, certificaciones catastrales, estudios ambientales y demás anexos descritos por las partes, con todas las servidumbres, obligaciones y garantías consignadas en el instrumento original;",
  "por un precio total de RD$25,000,000.00 pagadero en tres cuotas iguales los días 27/08/2026, 27/02/2027 y 27/08/2027, sujeto a la comprobación de los linderos, al registro del acto definitivo y al cumplimiento de las condiciones expresamente establecidas para la transferencia del inmueble.",
].join(" ");

const INITIATIVE_5253_SOURCE_TITLE =
  "Proyecto de ley que declara áreas protegidas nacionales el jardín botánico nacional Rafael M. Moscoso, el parque zoológico nacional arquitecto Manuel Valverde Podesta, el parque Mirador Sur del Distrito Nacional y el parque Mirador Norte de la provincia Santo Domingo.";

async function seedInitiative(
  db: Database,
  sourceId: string,
  title: string,
  opts: { province?: string; status?: string; filedAt?: string } = {},
) {
  return upsertInitiative(db, {
    source: "worker-title-translation-test",
    sourceId,
    kind: "LEGISLATIVE",
    title,
    province: opts.province,
    status: opts.status,
    filedAt: opts.filedAt,
  });
}

function fakeProvider(
  model: string,
  translate: (sourceTitle: string) => string | Promise<string>,
): InitiativeTitleTranslationProvider {
  return {
    model,
    async translateTitle(sourceTitle) {
      return translate(sourceTitle);
    },
  };
}

describe("offline initiative-title translation provider", () => {
  it("loads one revision-pinned q8 NLLB pipeline and uses deterministic ES→EN generation", async () => {
    let loads = 0;
    let disposed = 0;
    const generationCalls: Array<{ sourceTitle: string; options: unknown }> = [];
    const loadPipeline: TranslationPipelineLoader = async (task, model, options) => {
      loads++;
      assert.equal(task, "translation");
      assert.equal(model, INITIATIVE_TITLE_TRANSLATION_MODEL);
      assert.deepEqual(options, {
        dtype: "q8",
        revision: INITIATIVE_TITLE_TRANSLATION_REVISION,
      });
      return Object.assign(
        async (sourceTitle: string, generationOptions: unknown) => {
          generationCalls.push({ sourceTitle, options: generationOptions });
          return [{ translation_text: "Public Health Bill" }];
        },
        {
          async dispose() {
            disposed++;
          },
        },
      );
    };

    const provider = await createOfflineInitiativeTitleTranslationProvider(loadPipeline);
    assert.equal(INITIATIVE_TITLE_TRANSLATION_PIPELINE_VERSION, "v4");
    assert.equal(provider.model, INITIATIVE_TITLE_TRANSLATION_PROVENANCE);
    assert.match(provider.model, /Xenova\/nllb-200-distilled-600M/);
    assert.match(provider.model, new RegExp(INITIATIVE_TITLE_TRANSLATION_REVISION));
    assert.match(provider.model, /v4$/);
    assert.equal(await provider.translateTitle("Proyecto de salud pública"), "Public Health Bill");
    assert.equal(await provider.translateTitle("Otro proyecto"), "Public Health Bill");
    assert.equal(loads, 1);
    assert.deepEqual(generationCalls, [
      {
        sourceTitle: "Proyecto de salud pública",
        options: {
          src_lang: "spa_Latn",
          tgt_lang: "eng_Latn",
          do_sample: false,
          num_beams: 1,
          max_new_tokens: MAX_TRANSLATED_TITLE_TOKENS,
        },
      },
      {
        sourceTitle: "Otro proyecto",
        options: {
          src_lang: "spa_Latn",
          tgt_lang: "eng_Latn",
          do_sample: false,
          num_beams: 1,
          max_new_tokens: MAX_TRANSLATED_TITLE_TOKENS,
        },
      },
    ]);
    await provider.dispose?.();
    assert.equal(disposed, 1);
  });

  it("rejects malformed, empty, unsafe, and oversized output", () => {
    assert.throws(() => validateTranslatedInitiativeTitle(null), /no es texto/);
    assert.throws(() => validateTranslatedInitiativeTitle("   "), /está vacía/);
    assert.throws(() => validateTranslatedInitiativeTitle("Unsafe\nTitle"), /controles/);
    assert.throws(
      () => validateTranslatedInitiativeTitle("x".repeat(MAX_TRANSLATED_TITLE_CHARACTERS + 1)),
      /excede/,
    );
    assert.equal(validateTranslatedInitiativeTitle("  Public Health Bill  "), "Public Health Bill");
  });

  it("translates long protected titles sequentially and rejoins their punctuation in order", async () => {
    const protectedTitle = protectInitiativeTitleAcronyms(LONG_LEGAL_SOURCE_TITLE).text;
    const expectedChunks = chunkProtectedInitiativeTitle(protectedTitle);
    const calls: Array<{ sourceTitle: string; options: unknown }> = [];
    let activeCalls = 0;
    let maxActiveCalls = 0;
    const loadPipeline: TranslationPipelineLoader = async () =>
      Object.assign(
        async (sourceTitle: string, options: unknown) => {
          activeCalls++;
          maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
          try {
            await Promise.resolve();
            calls.push({ sourceTitle, options });
            const punctuation = sourceTitle.match(/[.!?;:,…]$/u)?.[0] ?? "";
            return [{ translation_text: `Translated part ${calls.length}${punctuation}` }];
          } finally {
            activeCalls--;
          }
        },
        { async dispose() {} },
      );
    const provider = await createOfflineInitiativeTitleTranslationProvider(loadPipeline);

    const translated = await provider.translateTitle(protectedTitle);
    assert.ok(expectedChunks.length >= 3);
    assert.deepEqual(
      calls.map(({ sourceTitle }) => sourceTitle),
      expectedChunks,
    );
    assert.equal(maxActiveCalls, 1);
    for (const { options } of calls) {
      assert.deepEqual(options, {
        src_lang: "spa_Latn",
        tgt_lang: "eng_Latn",
        do_sample: false,
        num_beams: 1,
        max_new_tokens: MAX_TRANSLATED_TITLE_TOKENS,
      });
    }
    assert.equal(
      translated,
      expectedChunks
        .map((chunk, index) => {
          const punctuation = chunk.match(/[.!?;:,…]$/u)?.[0] ?? "";
          return `Translated part ${index + 1}${punctuation}`;
        })
        .join(" "),
    );
  });

  it("retries initiative 5253 at its placeholder-separating conjunction without dropping text", async () => {
    const protectedTitle = protectInitiativeTitleAcronyms(INITIATIVE_5253_SOURCE_TITLE);
    assert.deepEqual(protectedTitle.replacements, [
      { placeholder: "ZXQACR0ZXQ", original: "Valverde" },
      { placeholder: "ZXQACR1ZXQ", original: "Distrito Nacional" },
      { placeholder: "ZXQACR2ZXQ", original: "Santo Domingo" },
    ]);
    const originalChunks = chunkProtectedInitiativeTitle(protectedTitle.text);
    assert.deepEqual(originalChunks, [
      "Proyecto de ley que declara áreas protegidas nacionales el jardín botánico nacional Rafael M. Moscoso, el parque zoológico nacional arquitecto Manuel ZXQACR0ZXQ Podesta,",
      "el parque Mirador Sur del ZXQACR1ZXQ y el parque Mirador Norte de la provincia ZXQACR2ZXQ.",
    ]);

    const fallbackChunks = splitProtectedChunkAtSpanishConjunctions(originalChunks[1]!);
    assert.deepEqual(fallbackChunks, [
      "el parque Mirador Sur del ZXQACR1ZXQ",
      "y el parque Mirador Norte de la provincia ZXQACR2ZXQ.",
    ]);
    assert.equal(fallbackChunks.join(" "), originalChunks[1]);

    const calls: string[] = [];
    const outputs = new Map([
      [
        originalChunks[0]!,
        "Bill declaring protected national areas the Rafael M. Moscoso national botanical garden, the Manuel ZXQACR0ZXQ Podesta national zoo,",
      ],
      [
        originalChunks[1]!,
        "the Mirador Sur park of ZXQACR1ZXQ and the Mirador Norte park in the province of ZXQACR2ZXQ ZXQACR2ZXQ.",
      ],
      [fallbackChunks[0]!, "the Mirador Sur park of ZXQACR1ZXQ"],
      [fallbackChunks[1]!, "and the Mirador Norte park in the province of ZXQACR2ZXQ."],
    ]);
    const loadPipeline: TranslationPipelineLoader = async () =>
      Object.assign(
        async (sourceTitle: string) => {
          calls.push(sourceTitle);
          const output = outputs.get(sourceTitle);
          assert.ok(output, `unexpected provider input: ${sourceTitle}`);
          return [{ translation_text: output }];
        },
        { async dispose() {} },
      );
    const provider = await createOfflineInitiativeTitleTranslationProvider(loadPipeline);

    const translated = await provider.translateTitle(protectedTitle.text);
    assert.deepEqual(calls, [originalChunks[0], originalChunks[1], ...fallbackChunks]);
    assert.equal(
      restoreInitiativeTitleAcronyms(translated, protectedTitle.replacements),
      "Bill declaring protected national areas the Rafael M. Moscoso national botanical garden, the Manuel Valverde Podesta national zoo, the Mirador Sur park of Distrito Nacional and the Mirador Norte park in the province of Santo Domingo.",
    );
  });
});

describe("initiative-title source integrity", () => {
  it("hashes the exact UTF-8 source title without trimming or normalization", () => {
    const exact = "  Proyecto sobre salud pública  ";
    assert.equal(
      hashExactInitiativeTitle(exact),
      createHash("sha256").update(exact, "utf8").digest("hex"),
    );
    assert.notEqual(hashExactInitiativeTitle(exact), hashExactInitiativeTitle(exact.trim()));
    assert.notEqual(
      hashExactInitiativeTitle(exact),
      hashExactInitiativeTitle(exact.normalize("NFC")),
    );
  });

  it("rejects list-only Senate titles ending in three dots or a Unicode ellipsis", () => {
    for (const title of ["Proyecto pendiente...", "Proyecto pendiente…", "Proyecto pendiente…  "]) {
      assert.throws(
        () => validateSourceInitiativeTitle(title),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "INCOMPLETE_SOURCE_TITLE" &&
          /ficha verificada/.test(error.message),
      );
    }
    assert.equal(validateSourceInitiativeTitle("Proyecto completo."), "Proyecto completo.");
  });

  it("preserves exact ordered numeric, separator, currency, and percent literals", () => {
    const source =
      "Contrato 05956-2024-2028 por RD$25,000,000.00, fecha 27/08/2026 y tasa 12.5 % en 3 cuotas";
    const translated =
      "Contract 05956-2024-2028 for RD$25,000,000.00, dated 27/08/2026 at 12.5 % in 3 installments";
    assert.deepEqual(initiativeTitleNumericIntegrityTokens(source), [
      "05956-2024-2028",
      "$25,000,000.00",
      "27/08/2026",
      "12.5 %",
      "3",
    ]);
    assert.equal(validateInitiativeTitleNumericIntegrity(source, translated), translated);

    for (const corrupted of [
      "Contract 05956-2024-2028 for RD25,000,000.00, dated 27/08/2026 at 12.5 % in 3 installments",
      "Contract 05956-2024-2028 for RD$25.000.000,00, dated 27/08/2026 at 12.5 % in 3 installments",
      "Contract 05956-2024-2028 for RD$25,000,000.00, dated 08/27/2026 at 12.5 % in 3 installments",
      "Contract 05956-2024-2028 for RD$25,000,000.00, dated 27/08/2026 at 3 installments and 12.5 %",
      `${translated} in 4 phases`,
    ]) {
      assert.throws(
        () => validateInitiativeTitleNumericIntegrity(source, corrupted),
        (error: unknown) =>
          error instanceof Error && "code" in error && error.code === "NUMERIC_INTEGRITY_MISMATCH",
      );
    }
    assert.equal(
      validateInitiativeTitleNumericIntegrity(
        "Pagadero en tres cuotas",
        "Payable in three installments",
      ),
      "Payable in three installments",
    );
  });

  it("repairs only dropped leading zeroes on aligned plain unsigned integers", () => {
    const source = "Resoluciones número 08 y 04";
    const translated = "Resolutions number 8 and 4";
    const repaired = repairInitiativeTitleLeadingZeroIntegers(source, translated);
    assert.equal(repaired, "Resolutions number 08 and 04");
    assert.equal(validateInitiativeTitleNumericIntegrity(source, repaired), repaired);

    for (const [sourceToken, translatedToken] of [
      ["01", "1st"],
      ["02", "2nd"],
      ["03", "3rd"],
      ["04", "4th"],
      ["011", "11th"],
      ["012", "12th"],
      ["013", "13th"],
      ["021", "21st"],
    ] as const) {
      const ordinalSource = `Día ${sourceToken}`;
      const ordinalTranslation = `Day ${translatedToken}`;
      const ordinalRepaired = repairInitiativeTitleLeadingZeroIntegers(
        ordinalSource,
        ordinalTranslation,
      );
      assert.equal(ordinalRepaired, `Day ${sourceToken}`);
      assert.equal(
        validateInitiativeTitleNumericIntegrity(ordinalSource, ordinalRepaired),
        ordinalRepaired,
      );
    }

    for (const [unsafeSource, unsafeTranslation] of [
      ["Resolución 08", "Resolution 9"],
      ["Resolución 08", "Resolution 8.0"],
      ["Resoluciones 08 y 04", "Resolutions 8"],
      ["Resolución 08", "Resolution 8 and 9"],
      ["Resoluciones 08 y 04", "Resolutions 4 and 8"],
      ["Monto RD$08", "Amount RD$8"],
      ["Balance -08", "Balance -8"],
      ["Fecha 08/2026", "Date 8/2026"],
      ["Código A08B", "Code A8B"],
      ["Día 04", "Day 5th"],
      ["Día 04", "Day 4st"],
      ["Día 01", "Day 1th"],
      ["Día 02", "Day 2rd"],
      ["Día 03", "Day 3nd"],
      ["Día 011", "Day 11st"],
      ["Día 04", "Day 4foo"],
      ["Día 04", "Day A4th"],
      ["Día 04", "Day 4thCode"],
      ["Código A\u030108", "Code A\u03018"],
      ["Ordinal 04.º", "Ordinal 4th"],
      ["Ordinal 04°", "Ordinal 4th"],
      ["Ordinal .08", "Ordinal 8"],
      ["Código #08", "Code #8"],
      ["Balance −08", "Balance −8"],
      ["Día 04", "Day 4th’s"],
      ["Día 04", "Day 4th‑Code"],
      ["Código 𐐀08", "Code 𐐀8"],
      ["Días 04 y 08", "Days 4th and 9"],
    ] as const) {
      assert.equal(
        repairInitiativeTitleLeadingZeroIntegers(unsafeSource, unsafeTranslation),
        unsafeTranslation,
      );
      assert.throws(
        () => validateInitiativeTitleNumericIntegrity(unsafeSource, unsafeTranslation),
        (error: unknown) =>
          error instanceof Error && "code" in error && error.code === "NUMERIC_INTEGRITY_MISMATCH",
      );
    }
  });

  it("protects the four province literals observed changing under NLLB", () => {
    const sourceTitle = "Distrito Nacional; La Altagracia; Elías Piña; La Vega";
    const protectedTitle = protectInitiativeTitleAcronyms(sourceTitle);
    assert.equal(protectedTitle.text, "ZXQACR0ZXQ; ZXQACR1ZXQ; ZXQACR2ZXQ; ZXQACR3ZXQ");
    assert.deepEqual(
      protectedTitle.replacements.map(({ original }) => original),
      ["Distrito Nacional", "La Altagracia", "Elías Piña", "La Vega"],
    );
    assert.equal(
      restoreInitiativeTitleAcronyms(protectedTitle.text, protectedTitle.replacements),
      sourceTitle,
    );
  });

  it("round-trips all 32 canonical provinces and their source spelling aliases", () => {
    assert.equal(DOMINICAN_PROVINCE_NAMES.length, 32);
    const literals = [...DOMINICAN_PROVINCE_NAMES, ...DOMINICAN_PROVINCE_SOURCE_ALIASES];
    const sourceTitle = literals.join(" | ");
    const protectedTitle = protectInitiativeTitleAcronyms(sourceTitle);
    assert.deepEqual(
      protectedTitle.replacements.map(({ original }) => original),
      literals,
    );
    assert.equal(protectedTitle.replacements.length, 35);
    assert.equal(
      restoreInitiativeTitleAcronyms(protectedTitle.text, protectedTitle.replacements),
      sourceTitle,
    );
  });

  it("protects province names before acronyms without double-protecting placeholders", () => {
    const sourceTitle = "Convenio de las ARS para La Vega con IDAC en Bahoruco";
    const protectedTitle = protectInitiativeTitleAcronyms(sourceTitle);
    assert.equal(
      protectedTitle.text,
      "Convenio de las ZXQACR2ZXQ para ZXQACR0ZXQ con ZXQACR3ZXQ en ZXQACR1ZXQ",
    );
    assert.deepEqual(protectedTitle.replacements, [
      { placeholder: "ZXQACR0ZXQ", original: "La Vega" },
      { placeholder: "ZXQACR1ZXQ", original: "Bahoruco" },
      { placeholder: "ZXQACR2ZXQ", original: "ARS" },
      { placeholder: "ZXQACR3ZXQ", original: "IDAC" },
    ]);
    for (const { placeholder } of protectedTitle.replacements) {
      assert.equal(protectedTitle.text.split(placeholder).length - 1, 1);
    }
    assert.equal(
      restoreInitiativeTitleAcronyms(protectedTitle.text, protectedTitle.replacements),
      sourceTitle,
    );
  });

  it("leaves lowercase common independencia and standalone Nacional unprotected", () => {
    const sourceTitle = "Proyecto sobre la independencia en la vega y representación Nacional";
    assert.deepEqual(protectInitiativeTitleAcronyms(sourceTitle), {
      text: sourceTitle,
      replacements: [],
    });
  });

  it("protects ARS and other uppercase acronyms and fails closed if a marker mutates", () => {
    const protectedTitle = protectInitiativeTitleAcronyms(
      "Proyecto que regula las ARS y coordina con el IDAC",
    );
    assert.equal(
      protectedTitle.text,
      "Proyecto que regula las ZXQACR0ZXQ y coordina con el ZXQACR1ZXQ",
    );
    assert.deepEqual(protectedTitle.replacements, [
      { placeholder: "ZXQACR0ZXQ", original: "ARS" },
      { placeholder: "ZXQACR1ZXQ", original: "IDAC" },
    ]);
    assert.equal(
      restoreInitiativeTitleAcronyms(
        "Bill regulating ZXQACR0ZXQ in coordination with ZXQACR1ZXQ",
        protectedTitle.replacements,
      ),
      "Bill regulating ARS in coordination with IDAC",
    );
    assert.throws(
      () =>
        restoreInitiativeTitleAcronyms(
          "Bill regulating HRS in coordination with ZXQACR1ZXQ",
          protectedTitle.replacements,
        ),
      /no conservó exactamente una vez/,
    );
    assert.throws(
      () =>
        restoreInitiativeTitleAcronyms(
          "ZXQACR0ZXQ and ZXQACR0ZXQ with ZXQACR1ZXQ",
          protectedTitle.replacements,
        ),
      /no conservó exactamente una vez/,
    );
  });

  it("keeps ordinary all-uppercase Senate words translatable while protecting known acronyms", () => {
    const protectedTitle = protectInitiativeTitleAcronyms(
      "PROYECTO DE LEY PARA LAS ARS, UTECT E IDAC EN 2026",
    );
    assert.equal(
      protectedTitle.text,
      "PROYECTO DE LEY PARA LAS ZXQACR0ZXQ, ZXQACR1ZXQ E ZXQACR2ZXQ EN 2026",
    );
    assert.deepEqual(
      protectedTitle.replacements.map(({ original }) => original),
      ["ARS", "UTECT", "IDAC"],
    );
    assert.equal(
      restoreInitiativeTitleAcronyms(
        "BILL FOR ZXQACR0ZXQ, ZXQACR1ZXQ AND ZXQACR2ZXQ IN 2026",
        protectedTitle.replacements,
      ),
      "BILL FOR ARS, UTECT AND IDAC IN 2026",
    );
  });

  it("leaves mixed-title dates and money literal while protecting only CEA and RD", () => {
    const sourceTitle =
      "Contrato del CEA de fecha 27/08/2026 por RD$25,000,000.00 y 12,345.67 metros cuadrados";
    const protectedTitle = protectInitiativeTitleAcronyms(sourceTitle);
    assert.equal(
      protectedTitle.text,
      "Contrato del ZXQACR0ZXQ de fecha 27/08/2026 por ZXQACR1ZXQ$25,000,000.00 y 12,345.67 metros cuadrados",
    );
    assert.deepEqual(protectedTitle.replacements, [
      { placeholder: "ZXQACR0ZXQ", original: "CEA" },
      { placeholder: "ZXQACR1ZXQ", original: "RD" },
    ]);

    const alphanumeric = protectInitiativeTitleAcronyms("Convenio IDAC2 para 2026");
    assert.equal(alphanumeric.text, "Convenio ZXQACR0ZXQ para 2026");
    assert.deepEqual(alphanumeric.replacements, [{ placeholder: "ZXQACR0ZXQ", original: "IDAC2" }]);
  });

  it("chunks a long legal title without splitting dates, money, acronyms, or punctuation", () => {
    const protectedTitle = protectInitiativeTitleAcronyms(LONG_LEGAL_SOURCE_TITLE);
    assert.deepEqual(
      protectedTitle.replacements.map(({ original }) => original),
      ["CEA", "RD"],
    );
    const chunks = chunkProtectedInitiativeTitle(protectedTitle.text);
    assert.ok(LONG_LEGAL_SOURCE_TITLE.length > 700);
    assert.ok(chunks.length >= 3);
    assert.ok(chunks.every((chunk) => chunk.length <= MAX_PROTECTED_TITLE_CHUNK_CHARACTERS));
    assert.equal(chunks.join(" "), protectedTitle.text);
    assert.ok(chunks.slice(0, -1).every((chunk) => /[.!?;:,…]$/u.test(chunk)));
    for (const { placeholder } of protectedTitle.replacements) {
      assert.equal(chunks.filter((chunk) => chunk.includes(placeholder)).length, 1);
    }
    assert.ok(chunks.some((chunk) => chunk.includes("Rafael A. Pérez")));
    assert.ok(chunks.some((chunk) => chunk.includes("ZXQACR1ZXQ$25,000,000.00")));
    assert.ok(chunks.some((chunk) => chunk.includes("27/08/2026")));

    const indivisible = `prefijo ${"A".repeat(40)} ZXQACR0ZXQ final`;
    const tinyChunks = chunkProtectedInitiativeTitle(indivisible, 8);
    assert.ok(tinyChunks.includes("A".repeat(40)));
    assert.ok(tinyChunks.includes("ZXQACR0ZXQ"));
  });
});

describe("initiative-title translation batch", () => {
  it("persists a fake-provider translation with the exact source hash and restores ARS", async () => {
    const handle = createDb();
    try {
      await handle.ensureSchema();
      const sourceTitle = "Proyecto de ley que regula las ARS";
      const initiative = await seedInitiative(handle.db, "ars-preservation", sourceTitle);
      const seen: string[] = [];
      const provider = fakeProvider("fake-ars-model", (protectedTitle) => {
        seen.push(protectedTitle);
        return "Bill regulating ZXQACR0ZXQ";
      });

      const result = await runInitiativeTitleTranslationBatch(handle.db, {
        provider,
        initiativeIds: [initiative.id],
      });
      assert.deepEqual(result, {
        candidates: 1,
        translated: 1,
        skipped: 0,
        failed: 0,
        failures: [],
      });
      assert.deepEqual(seen, ["Proyecto de ley que regula las ZXQACR0ZXQ"]);
      const rows = await handle.db.select().from(initiativeTitleTranslations);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.sourceTitle, sourceTitle);
      assert.equal(rows[0]?.sourceTitleHash, hashExactInitiativeTitle(sourceTitle));
      assert.equal(rows[0]?.translatedTitle, "Bill regulating ARS");
      assert.equal(rows[0]?.model, provider.model);

      const retry = await runInitiativeTitleTranslationBatch(handle.db, {
        provider,
        initiativeIds: [initiative.id],
      });
      assert.equal(retry.candidates, 0);
      assert.equal(seen.length, 1);
    } finally {
      await handle.close();
    }
  });

  it("fails closed without persistence when a provider alters a numeric literal", async () => {
    const handle = createDb();
    try {
      await handle.ensureSchema();
      const initiative = await seedInitiative(
        handle.db,
        "numeric-integrity-refusal",
        "Contrato de fecha 27/08/2026 por RD$25,000,000.00",
      );
      const provider = fakeProvider(
        "fake-corrupt-number-model",
        () => "Contract dated 08/27/2026 for ZXQACR0ZXQ$25,000,000.00",
      );
      const result = await runInitiativeTitleTranslationBatch(handle.db, {
        provider,
        initiativeIds: [initiative.id],
      });
      assert.equal(result.translated, 0);
      assert.equal(result.failed, 1);
      assert.match(result.failures[0]?.error ?? "", /literales numéricos/);
      assert.deepEqual(await handle.db.select().from(initiativeTitleTranslations), []);
    } finally {
      await handle.close();
    }
  });

  it("repairs dropped leading zeroes before the strict persistence gate", async () => {
    const handle = createDb();
    try {
      await handle.ensureSchema();
      const initiative = await seedInitiative(
        handle.db,
        "numeric-leading-zero-repair",
        "Resolución número 08 que declara el 04 de marzo",
      );
      const provider = fakeProvider(
        "fake-leading-zero-model",
        () => "Resolution number 8 declaring March 4th",
      );
      const result = await runInitiativeTitleTranslationBatch(handle.db, {
        provider,
        initiativeIds: [initiative.id],
      });
      assert.equal(result.translated, 1);
      assert.equal(result.failed, 0);
      const [row] = await handle.db.select().from(initiativeTitleTranslations);
      assert.equal(row?.translatedTitle, "Resolution number 08 declaring March 04");
    } finally {
      await handle.close();
    }
  });

  it("paginates --all with a strict cursor and does not retry failures forever", async () => {
    const handle = createDb();
    try {
      await handle.ensureSchema();
      const initiatives = await Promise.all(
        Array.from({ length: 7 }, (_, index) =>
          seedInitiative(handle.db, `all-${index}`, `Proyecto completo ${index}`),
        ),
      );
      let calls = 0;
      const failedId = initiatives[4]!.id;
      const provider = fakeProvider("fake-all-model", (sourceTitle) => {
        calls++;
        if (sourceTitle.endsWith("4")) throw new Error("fallo simulado");
        return `English ${sourceTitle}`;
      });
      const result = await runInitiativeTitleTranslationBatch(handle.db, {
        provider,
        all: true,
        limit: 3,
      });
      assert.equal(result.candidates, 7);
      assert.equal(result.translated, 6);
      assert.equal(result.failed, 1);
      assert.deepEqual(result.failures, [{ initiativeId: failedId, error: "fallo simulado" }]);
      assert.equal(calls, 7);
    } finally {
      await handle.close();
    }
  });

  it("exhausts the exact five latest deposited HOME rows in bounded pages", async () => {
    const handle = createDb();
    try {
      await handle.ensureSchema();
      const province = "Provincia worker HOME";
      const deposited = [];
      for (let index = 0; index < 6; index++) {
        deposited.push(
          await seedInitiative(handle.db, `home-deposited-${index}`, `Proyecto HOME ${index}`, {
            province,
            status: "Depositado",
            filedAt: `2026-08-${String(index + 1).padStart(2, "0")}`,
          }),
        );
      }
      const active = await seedInitiative(handle.db, "home-active", "Proyecto HOME activo", {
        province,
        status: "Activo",
        filedAt: "2026-08-28",
      });
      const provider = fakeProvider("fake-home-model", (sourceTitle) => `English ${sourceTitle}`);
      const result = await runInitiativeTitleTranslationBatch(handle.db, {
        provider,
        home: true,
        limit: 2,
      });
      assert.equal(result.candidates, 5);
      assert.equal(result.translated, 5);

      const remaining = await listInitiativeTitleTranslationCandidates(handle.db, {
        model: provider.model,
        initiativeIds: [...deposited.map(({ id }) => id), active.id],
        limit: 100,
      });
      assert.deepEqual(
        remaining.map(({ initiativeId }) => initiativeId).sort((a, b) => a - b),
        [deposited[0]!.id, active.id].sort((a, b) => a - b),
      );
    } finally {
      await handle.close();
    }
  });
});

describe("initiative-title CLI ID parsing", () => {
  it("accepts repeatable and comma-separated IDs and deduplicates them", () => {
    assert.deepEqual(
      parseInitiativeTitleIds([
        "node",
        "worker",
        "--initiative-id",
        "9,4",
        "--initiative-id=4,12",
        "--initiative-id",
        "7",
      ]),
      [9, 4, 12, 7],
    );
  });

  it("rejects missing, empty, malformed, non-positive, and unsafe IDs", () => {
    for (const argv of [
      ["--initiative-id"],
      ["--initiative-id="],
      ["--initiative-id", "1,,2"],
      ["--initiative-id", "0"],
      ["--initiative-id", "-1"],
      ["--initiative-id", "1.5"],
      ["--initiative-id", String(Number.MAX_SAFE_INTEGER + 1)],
    ]) {
      assert.throws(() => parseInitiativeTitleIds(argv), /initiative-id/);
    }
  });
});

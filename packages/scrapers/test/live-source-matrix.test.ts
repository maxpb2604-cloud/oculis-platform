import { describe, expect, it } from "vitest";
import {
  DipOficialAdapter,
  DiputadosRosterAdapter,
  officialFeedAdapters,
  regulatoryAdapters,
  SenadoAdapter,
  SenadoRosterAdapter,
  SenadoSilAdapter,
  SilActividadAdapter,
  SilDiputadosAdapter,
  sourceRegistryEntry,
} from "../src/index.js";

interface SmokeRow {
  observedAt: string;
  source: string;
  url: string;
  ok: boolean;
  count: number;
  secondaryCount?: number;
  gaps: string[];
  structuralGaps: string[];
  contract: SmokeContract;
  error?: string;
}

type FactualGapKind =
  | "DIPUTADOS_DAILY_PDF_NOT_PUBLISHED"
  | "SENATE_COMMISSION_DATE_NOT_PUBLISHED"
  | "SENATE_ROSTER_EFFECTIVE_DATE_NOT_PUBLISHED";

interface SmokeContract {
  /** A source must explicitly declare whether an empty official collection is valid. */
  allowZero: boolean;
  /** Literal lower bound required by the source contract, never a historical-count guess. */
  minCount: number;
  /** Exact upstream omissions that remain visible but do not indicate a parser failure. */
  toleratedFactualGapKinds: readonly FactualGapKind[];
}

const REQUIRED_NONEMPTY: SmokeContract = {
  allowZero: false,
  // One proves that the parser still sees at least one official record. Exact factual
  // cardinalities (for example, 32 senators) remain asserted at their call site.
  minCount: 1,
  toleratedFactualGapKinds: [],
};

const OPTIONAL_OBSERVATION: SmokeContract = {
  allowZero: true,
  minCount: 0,
  toleratedFactualGapKinds: [],
};

function requiredNonemptyWithFactualGaps(
  ...toleratedFactualGapKinds: FactualGapKind[]
): SmokeContract {
  return { ...REQUIRED_NONEMPTY, toleratedFactualGapKinds };
}

const DIPUTADOS_ACTIVITY_CONTRACT = requiredNonemptyWithFactualGaps(
  "DIPUTADOS_DAILY_PDF_NOT_PUBLISHED",
);
const SENATE_AGENDA_CONTRACT = requiredNonemptyWithFactualGaps(
  "SENATE_COMMISSION_DATE_NOT_PUBLISHED",
);
const SENATE_ROSTER_CONTRACT = requiredNonemptyWithFactualGaps(
  "SENATE_ROSTER_EFFECTIVE_DATE_NOT_PUBLISHED",
);

function splitReportedGaps(gaps: readonly string[]): string[] {
  return gaps.flatMap((gap) =>
    gap
      .split(" | ")
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

function matchesFactualGapKind(gap: string, kind: FactualGapKind): boolean {
  if (kind === "DIPUTADOS_DAILY_PDF_NOT_PUBLISHED") {
    return (
      /^Diputados · agenda de comisiones \(\d{4}-\d{2}-\d{2}\): la fuente no publicó un PDF diario con esa fecha literal\.$/.test(
        gap,
      ) ||
      /^Diputados · agenda PDF diaria: \d+ de \d+ filas no tuvieron un PDF único y verificable por fecha; 0 fila\(s\) no tuvieron evidencia literal suficiente de la comisión y su agenda dentro del PDF\.$/.test(
        gap,
      )
    );
  }
  if (kind === "SENATE_COMMISSION_DATE_NOT_PUBLISHED") {
    return /^Senado · \d+ comisión\(es\) sin fecha exacta en ".+"; el campo date queda null\.$/.test(
      gap,
    );
  }
  if (kind === "SENATE_ROSTER_EFFECTIVE_DATE_NOT_PUBLISHED") {
    return /^roster-senado: el listado HTML de comisiones no publica una fecha exacta de vigencia; no se infiere ni se fabrica una\.$/.test(
      gap,
    );
  }
  return false;
}

function structuralGaps(gaps: readonly string[], contract: SmokeContract): string[] {
  return splitReportedGaps(gaps).filter(
    (gap) => !contract.toleratedFactualGapKinds.some((kind) => matchesFactualGapKind(gap, kind)),
  );
}

function completedSmokeRow(
  observedAt: string,
  source: string,
  url: string,
  result: { count: number; secondaryCount?: number; gaps?: string[] },
  contract: SmokeContract,
): SmokeRow {
  if (!Number.isSafeInteger(contract.minCount) || contract.minCount < 0) {
    throw new Error(`${source}: minCount must be a non-negative integer`);
  }
  if (contract.allowZero && contract.minCount !== 0) {
    throw new Error(`${source}: allowZero requires minCount=0`);
  }
  if (!contract.allowZero && contract.minCount < 1) {
    throw new Error(`${source}: a non-empty contract requires minCount>=1`);
  }
  const gaps = result.gaps ?? [];
  const incomplete = structuralGaps(gaps, contract);
  const failures: string[] = [];
  if (!Number.isSafeInteger(result.count) || result.count < contract.minCount) {
    failures.push(`cardinality ${result.count}; expected at least ${contract.minCount}`);
  }
  if (incomplete.length > 0) {
    failures.push(`structural gaps: ${incomplete.join(" | ")}`);
  }
  return {
    observedAt,
    source,
    url,
    ok: failures.length === 0,
    count: result.count,
    ...(result.secondaryCount == null ? {} : { secondaryCount: result.secondaryCount }),
    gaps,
    structuralGaps: incomplete,
    contract,
    ...(failures.length === 0 ? {} : { error: failures.join("; ") }),
  };
}

function failedSmokeRow(
  observedAt: string,
  source: string,
  url: string,
  error: unknown,
  contract: SmokeContract,
): SmokeRow {
  return {
    observedAt,
    source,
    url,
    ok: false,
    count: 0,
    gaps: [],
    structuralGaps: [],
    contract,
    error: error instanceof Error ? error.message : String(error),
  };
}

function isUnexpectedRequiredFailure(row: SmokeRow): boolean {
  const registry = sourceRegistryEntry(row.source);
  // A source absent from the factual registry cannot silently become an optional check.
  if (!registry) return true;
  if (registry.status !== "ACTIVE" || registry.required === false) return false;
  // The registry, not the call site, owns requiredness. A future check cannot weaken an
  // ACTIVE required source by accidentally assigning it the optional observation contract.
  if (row.contract.allowZero || row.contract.minCount < 1) {
    return true;
  }
  return !row.ok || row.count === 0 || row.structuralGaps.length > 0;
}

const live = process.env.OCULIS_LIVE === "1";

describe("read-only official source matrix gate", () => {
  const observedAt = "2026-09-02T12:00:00.000Z";
  const url = "https://official.test/catalog";

  it("fails an ACTIVE required source on zero cardinality or structural gaps", () => {
    const empty = completedSmokeRow(
      observedAt,
      "feed-senado",
      url,
      { count: 0 },
      REQUIRED_NONEMPTY,
    );
    const partial = completedSmokeRow(
      observedAt,
      "reg-mispas",
      url,
      { count: 68, gaps: ["one official category was not reconciled"] },
      REQUIRED_NONEMPTY,
    );

    expect(empty).toMatchObject({ ok: false, count: 0 });
    expect(partial).toMatchObject({ ok: false, count: 68 });
    expect([empty, partial].filter(isUnexpectedRequiredFailure)).toEqual([empty, partial]);
  });

  it("keeps explicitly optional observations visible without failing the required gate", () => {
    const optional = completedSmokeRow(
      observedAt,
      "feed-x",
      url,
      { count: 0, gaps: ["API credential is not configured"] },
      OPTIONAL_OBSERVATION,
    );

    expect(optional).toMatchObject({ ok: false, count: 0 });
    expect(isUnexpectedRequiredFailure(optional)).toBe(false);
  });

  it("fails closed when a live check is not present in the factual source registry", () => {
    const unknown = completedSmokeRow(
      observedAt,
      "unregistered-source",
      url,
      { count: 1 },
      REQUIRED_NONEMPTY,
    );

    expect(isUnexpectedRequiredFailure(unknown)).toBe(true);
  });

  it("does not let a call-site optional contract weaken an ACTIVE required source", () => {
    const misconfigured = completedSmokeRow(
      observedAt,
      "feed-senado",
      url,
      { count: 0, gaps: ["empty official feed"] },
      OPTIONAL_OBSERVATION,
    );

    expect(misconfigured.ok).toBe(false);
    expect(isUnexpectedRequiredFailure(misconfigured)).toBe(true);
  });

  it("keeps exact upstream omissions visible while failing any unclassified gap", () => {
    const factual = completedSmokeRow(
      observedAt,
      "senado",
      url,
      {
        count: 6,
        gaps: [
          'Senado · 1 comisión(es) sin fecha exacta en "AGENDA SEMANAL"; el campo date queda null.',
        ],
      },
      SENATE_AGENDA_CONTRACT,
    );
    const structural = completedSmokeRow(
      observedAt,
      "senado",
      url,
      { count: 6, gaps: ["Senado · el catálogo cambió de estructura."] },
      SENATE_AGENDA_CONTRACT,
    );

    expect(factual).toMatchObject({ ok: true, structuralGaps: [] });
    expect(factual.gaps).toHaveLength(1);
    expect(structural).toMatchObject({
      ok: false,
      structuralGaps: ["Senado · el catálogo cambió de estructura."],
    });
  });

  it("keeps any unresolved Senate roster membership as a structural failure", () => {
    const complete = completedSmokeRow(
      observedAt,
      "roster-senado",
      url,
      {
        count: 32,
        secondaryCount: 251,
        gaps: [],
      },
      SENATE_ROSTER_CONTRACT,
    );
    const unresolved = completedSmokeRow(
      observedAt,
      "roster-senado",
      url,
      {
        count: 32,
        secondaryCount: 251,
        gaps: [
          "roster-senado: 1 de 251 membresías no tienen una coincidencia exacta y única de nombre; legislatorSourceId queda null.",
        ],
      },
      SENATE_ROSTER_CONTRACT,
    );

    expect(complete).toMatchObject({ ok: true, structuralGaps: [] });
    expect(unresolved).toMatchObject({ ok: false });
    expect(unresolved.structuralGaps).toHaveLength(1);
  });
});

describe.skipIf(!live)("read-only official source matrix", () => {
  it(
    "reads every implemented official source without database writes",
    async () => {
      const observedAt = new Date().toISOString();
      const rows: SmokeRow[] = [];
      async function check(
        source: string,
        url: string,
        contract: SmokeContract,
        collect: () => Promise<{ count: number; secondaryCount?: number; gaps?: string[] }>,
      ): Promise<void> {
        try {
          const result = await collect();
          rows.push(completedSmokeRow(observedAt, source, url, result, contract));
        } catch (error) {
          rows.push(failedSmokeRow(observedAt, source, url, error, contract));
        }
      }

      await check(
        "sil-diputados",
        "https://www.diputadosrd.gob.do/sil/api/iniciativa",
        REQUIRED_NONEMPTY,
        async () => {
          const adapter = new SilDiputadosAdapter();
          const [count, groups] = await Promise.all([adapter.count(), adapter.groups()]);
          const group = groups[0]!;
          const [current, expired] = await Promise.all([
            adapter.listPage(group.id, true, 1, false),
            adapter.listPage(group.id, true, 1, true),
          ]);
          const sample = current.results[0] ?? expired.results[0];
          if (sample) {
            await Promise.all([
              adapter.proponentes(sample.id),
              adapter.historicos(sample.id),
              adapter.documentos(sample.id),
            ]);
          }
          return {
            count,
            secondaryCount: groups.length,
          };
        },
      );

      await check(
        "sil-actividad",
        "https://www.diputadosrd.gob.do/sil/api/comision/ordenes",
        DIPUTADOS_ACTIVITY_CONTRACT,
        async () => {
          const result = await new SilActividadAdapter().collect();
          return { count: result.events.length, gaps: result.gaps };
        },
      );

      await check(
        "dip-oficial",
        "https://camaradediputados.gob.do/ordenes-del-dia-del-pleno/",
        REQUIRED_NONEMPTY,
        async () => {
          const refs = await new DipOficialAdapter().listOrdenes();
          return { count: refs.length };
        },
      );

      await check(
        "senado",
        "https://www.senadord.gob.do/secretaria-general-legislativa/orden-del-dia/",
        SENATE_AGENDA_CONTRACT,
        async () => {
          const result = await new SenadoAdapter().collect({
            parsePdfs: true,
            limitPerCategory: 1,
            committeeWeeks: 1,
          });
          return { count: result.events.length, gaps: result.gaps };
        },
      );

      await check(
        "senado-sil-corpus",
        "http://www.senado.gov.do/wfilemaster/lista_expedientes.aspx",
        REQUIRED_NONEMPTY,
        async () => {
          const result = await new SenadoSilAdapter().listDeposits();
          return { count: result.length };
        },
      );

      await check(
        "roster-diputados",
        "https://www.diputadosrd.gob.do/sil/api/legislador",
        REQUIRED_NONEMPTY,
        async () => {
          const result = await new DiputadosRosterAdapter().collect();
          if (result.legislators.length < 150 || result.memberships.length === 0) {
            throw new Error(
              `cardinality: ${result.legislators.length} legislators, ${result.memberships.length} memberships`,
            );
          }
          return {
            count: result.legislators.length,
            secondaryCount: result.memberships.length,
            gaps: result.gaps,
          };
        },
      );

      await check(
        "roster-senado",
        "https://www.senadord.gob.do/senadores-2024-2028/",
        SENATE_ROSTER_CONTRACT,
        async () => {
          const result = await new SenadoRosterAdapter().collect();
          if (result.legislators.length !== 32 || result.memberships.length !== 251) {
            throw new Error(
              `cardinality: ${result.legislators.length} legislators, ${result.memberships.length} memberships; expected exactly 32 and 251 for the audited 2024-2028 snapshot`,
            );
          }
          return {
            count: result.legislators.length,
            secondaryCount: result.memberships.length,
            gaps: result.gaps,
          };
        },
      );

      for (const adapter of regulatoryAdapters()) {
        await check(
          adapter.source,
          sourceRegistryEntry(adapter.source)?.officialUrl ?? "official URL in adapter provenance",
          REQUIRED_NONEMPTY,
          async () => {
            const result = await adapter.collect();
            return { count: result.regulations.length, gaps: result.gaps };
          },
        );
      }

      for (const adapter of officialFeedAdapters()) {
        await check(
          adapter.source,
          sourceRegistryEntry(adapter.source)?.officialUrl ?? "official chamber RSS",
          REQUIRED_NONEMPTY,
          async () => {
            const result = await adapter.collect();
            return { count: result.items.length, gaps: result.gaps };
          },
        );
      }

      console.log(`OCULIS_LIVE_SOURCE_MATRIX=${JSON.stringify(rows)}`);
      const unexpectedRequiredFailures = rows.filter(isUnexpectedRequiredFailure);
      expect(unexpectedRequiredFailures).toEqual([]);
    },
    10 * 60_000,
  );
});

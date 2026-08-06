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
  error?: string;
}

const live = process.env.OCULIS_LIVE === "1";

describe.skipIf(!live)("read-only official source matrix", () => {
  it(
    "reads every implemented official source without database writes",
    async () => {
      const observedAt = new Date().toISOString();
      const rows: SmokeRow[] = [];

      async function check(
        source: string,
        url: string,
        collect: () => Promise<{ count: number; secondaryCount?: number; gaps?: string[] }>,
      ): Promise<void> {
        try {
          const result = await collect();
          rows.push({
            observedAt,
            source,
            url,
            ok: true,
            count: result.count,
            ...(result.secondaryCount == null ? {} : { secondaryCount: result.secondaryCount }),
            gaps: result.gaps ?? [],
          });
        } catch (error) {
          rows.push({
            observedAt,
            source,
            url,
            ok: false,
            count: 0,
            gaps: [],
            error: (error as Error).message,
          });
        }
      }

      await check(
        "sil-diputados",
        "https://www.diputadosrd.gob.do/sil/api/iniciativa",
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
            gaps: [`sample current=${current.results.length}, perimidas=${expired.results.length}`],
          };
        },
      );

      await check(
        "sil-actividad",
        "https://www.diputadosrd.gob.do/sil/api/comision/ordenes",
        async () => {
          const result = await new SilActividadAdapter().collect();
          return { count: result.events.length, gaps: result.gaps };
        },
      );

      await check(
        "dip-oficial",
        "https://camaradediputados.gob.do/ordenes-del-dia-del-pleno/",
        async () => {
          const refs = await new DipOficialAdapter().listOrdenes();
          return { count: refs.length };
        },
      );

      await check(
        "senado",
        "https://www.senadord.gob.do/secretaria-general-legislativa/orden-del-dia/",
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
        async () => {
          const result = await new SenadoSilAdapter().listDeposits();
          return { count: result.length };
        },
      );

      await check(
        "roster-diputados",
        "https://www.diputadosrd.gob.do/sil/api/legislador",
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

      await check("roster-senado", "https://www.senadord.gob.do/senadores/", async () => {
        const result = await new SenadoRosterAdapter().collect();
        if (result.legislators.length < 30 || result.memberships.length === 0) {
          throw new Error(
            `cardinality: ${result.legislators.length} legislators, ${result.memberships.length} memberships`,
          );
        }
        return {
          count: result.legislators.length,
          secondaryCount: result.memberships.length,
          gaps: result.gaps,
        };
      });

      for (const adapter of regulatoryAdapters()) {
        await check(
          adapter.source,
          sourceRegistryEntry(adapter.source)?.officialUrl ?? "official URL in adapter provenance",
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
          async () => {
            const result = await adapter.collect();
            return { count: result.items.length, gaps: result.gaps };
          },
        );
      }

      console.log(`OCULIS_LIVE_SOURCE_MATRIX=${JSON.stringify(rows)}`);
      const unexpectedRequiredFailures = rows.filter((row) => {
        if (row.ok) return false;
        const registry = sourceRegistryEntry(row.source);
        return registry?.status !== "KNOWN_GAP" && registry?.required !== false;
      });
      expect(unexpectedRequiredFailures).toEqual([]);
    },
    10 * 60_000,
  );
});

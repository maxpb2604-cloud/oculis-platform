import { AppShell } from "@/components/app-shell";
import {
  SOURCE_REGISTRY,
  getMonitoringHealth,
  type SourceHealthFact,
  type SourceRegistryEntry,
} from "@/lib/data";
import type { Lang } from "@/lib/i18n";

export const dynamic = "force-dynamic";

interface SourceRow {
  source: string;
  registry: SourceRegistryEntry | null;
  run: SourceHealthFact | null;
}

export default async function SourceStatusPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const lang: Lang = (await searchParams).lang === "en" ? "en" : "es";
  const es = lang === "es";
  const recorded = await getMonitoringHealth();
  const bySource = new Map(recorded.map((row) => [row.source, row] as const));
  const registeredIds = new Set(SOURCE_REGISTRY.map((entry) => entry.id));
  const rows: SourceRow[] = [
    ...SOURCE_REGISTRY.map((entry) => ({
      source: entry.id,
      registry: entry,
      run: bySource.get(entry.id) ?? null,
    })),
    ...recorded
      .filter((row) => !registeredIds.has(row.source))
      .sort((a, b) => a.source.localeCompare(b.source))
      .map((run) => ({ source: run.source, registry: null, run })),
  ];

  return (
    <AppShell
      lang={lang}
      title={es ? "Estado de fuentes" : "Source status"}
      subtitle={
        es
          ? "Registro declarado de cobertura y ejecuciones guardadas"
          : "Declared coverage registry and stored runs"
      }
    >
      <p className="mb-4 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
        {es
          ? "La tabla combina el registro de fuentes con los hechos guardados por cada ejecución. No atribuye causas ni convierte las coberturas aún no implementadas en fallos operativos."
          : "The table combines the source registry with facts stored by each run. It does not infer causes or treat coverage that is not yet implemented as an operational failure."}
      </p>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[1680px] text-left text-xs">
          <caption className="sr-only">
            {es
              ? "Estado de ejecución de las fuentes de recolección"
              : "Collection source execution status"}
          </caption>
          <thead>
            <tr className="eyebrow border-b" style={{ background: "var(--surface-2)" }}>
              <th scope="col" className="px-4 py-3">
                {es ? "Fuente" : "Source"}
              </th>
              <th scope="col" className="px-3 py-3">
                {es ? "Cobertura declarada" : "Declared coverage"}
              </th>
              <th scope="col" className="px-3 py-3">
                {es ? "Cadencia" : "Cadence"}
              </th>
              <th scope="col" className="px-3 py-3">
                {es ? "Último resultado" : "Latest result"}
              </th>
              <th scope="col" className="px-3 py-3">
                {es ? "Tiempos registrados" : "Recorded timestamps"}
              </th>
              <th scope="col" className="px-3 py-3">
                {es ? "Última ejecución completa" : "Latest complete run"}
              </th>
              <th scope="col" className="px-3 py-3">
                {es ? "Última con filas observadas" : "Latest with observed rows"}
              </th>
              <th scope="col" className="px-3 py-3">
                {es ? "Vistos" : "Seen"}
              </th>
              <th scope="col" className="px-3 py-3">
                {es ? "Insertados" : "Inserted"}
              </th>
              <th scope="col" className="px-3 py-3">
                {es ? "Actualizados" : "Updated"}
              </th>
              <th scope="col" className="px-3 py-3">
                {es ? "Eventos de estado insertados" : "Status events inserted"}
              </th>
              <th scope="col" className="px-4 py-3">
                {es ? "Error / detalles guardados" : "Error / stored details"}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <SourceStatusRow key={row.source} row={row} lang={lang} />
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}

function SourceStatusRow({ row, lang }: { row: SourceRow; lang: Lang }) {
  const es = lang === "es";
  const missing = es ? "No informado" : "Not reported";
  const notApplicable = es ? "No aplica" : "Not applicable";
  const gapReason = row.registry?.status === "KNOWN_GAP" ? row.registry.gapReason : null;
  const gap = gapReason != null;
  const run = row.run;
  const result = gap
    ? es
      ? "Cobertura aún no implementada"
      : "Coverage not yet implemented"
    : !run
      ? es
        ? "Nunca ejecutada"
        : "Never run"
      : run.outcome === "RUNNING"
        ? es
          ? "En ejecución o interrumpida antes de finalizar"
          : "Running or interrupted before completion"
        : run.outcome === "COMPLETE"
          ? run.seen === 0
            ? es
              ? "Completa · cero filas observadas"
              : "Complete · zero observed rows"
            : es
              ? "Completa"
              : "Complete"
          : run.outcome === "PARTIAL"
            ? es
              ? "Parcial"
              : "Partial"
            : run.outcome === "FAILED"
              ? es
                ? "Falló"
                : "Failed"
              : es
                ? "No informado"
                : "Not reported";
  const emptyRunValue = gap ? notApplicable : missing;

  return (
    <tr className="border-b align-top last:border-0">
      <th scope="row" className="max-w-[260px] px-4 py-3">
        {row.registry?.officialUrl ? (
          <a
            href={row.registry.officialUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold underline-offset-2 hover:underline"
            style={{ color: "var(--accent)" }}
          >
            {row.registry.label} ↗
          </a>
        ) : (
          <span className="font-semibold">{row.registry?.label ?? row.source}</span>
        )}
        {row.registry && (
          <div className="mt-1 font-normal" style={{ color: "var(--text-muted)" }}>
            {row.registry.owner}
          </div>
        )}
        <div
          className="mt-1 font-mono text-[10px] font-normal"
          style={{ color: "var(--text-muted)" }}
        >
          {row.source}
        </div>
      </th>
      <td className="max-w-[320px] px-3 py-3">{row.registry?.coverage ?? missing}</td>
      <td className="px-3 py-3">
        {row.registry ? cadenceLabel(row.registry.cadence, lang) : missing}
      </td>
      <td className="px-3 py-3 font-semibold">{result}</td>
      <td className="tnum px-3 py-3">
        {run ? <RunTimestamps run={run} lang={lang} missing={missing} /> : emptyRunValue}
      </td>
      <td className="tnum px-3 py-3">{run?.lastSuccessAt ?? emptyRunValue}</td>
      <td className="tnum px-3 py-3">{run?.lastDataAt ?? emptyRunValue}</td>
      <td className="tnum px-3 py-3">{run ? run.seen : emptyRunValue}</td>
      <td className="tnum px-3 py-3">{run ? run.inserted : emptyRunValue}</td>
      <td className="tnum px-3 py-3">{run ? run.updated : emptyRunValue}</td>
      <td className="tnum px-3 py-3">{run ? run.statusChanges : emptyRunValue}</td>
      <td className="max-w-[360px] px-4 py-3">
        {gap ? (
          gapReason
        ) : run ? (
          <RunNotes error={run.error} details={run.details} missing={missing} />
        ) : (
          missing
        )}
      </td>
    </tr>
  );
}

function RunTimestamps({
  run,
  lang,
  missing,
}: {
  run: SourceHealthFact;
  lang: Lang;
  missing: string;
}) {
  const details =
    run.details && typeof run.details === "object" && !Array.isArray(run.details)
      ? (run.details as Record<string, unknown>)
      : null;
  const explicitStart = details?.lifecycle === "EXPLICIT_BEGIN_FINISH";
  const firstLabel = explicitStart
    ? lang === "es"
      ? "Inicio"
      : "Start"
    : lang === "es"
      ? "Registro"
      : "Recorded";
  const finishLabel = lang === "es" ? "Final" : "Finish";
  return (
    <div className="space-y-1 whitespace-nowrap">
      <div>
        {firstLabel}: {run.recordedAt}
      </div>
      <div>
        {finishLabel}: {run.finishedAt ?? missing}
      </div>
    </div>
  );
}

function cadenceLabel(cadence: SourceRegistryEntry["cadence"], lang: Lang): string {
  const labels: Record<SourceRegistryEntry["cadence"], readonly [string, string]> = {
    THREE_TIMES_DAILY: ["3 veces al día", "3 times daily"],
    DAILY: ["Diaria", "Daily"],
    WEEKLY: ["Semanal", "Weekly"],
    BOOTSTRAP: ["Carga inicial", "Bootstrap"],
    MANUAL: ["Manual", "Manual"],
    NOT_SCHEDULED: ["No programada", "Not scheduled"],
  };
  return labels[cadence][lang === "es" ? 0 : 1];
}

function RunNotes({
  error,
  details,
  missing,
}: {
  error: string | null;
  details: unknown;
  missing: string;
}) {
  const renderedDetails = details == null ? null : JSON.stringify(details, null, 2);
  if (!error && !renderedDetails)
    return <span style={{ color: "var(--text-muted)" }}>{missing}</span>;
  return (
    <div className="space-y-2 break-words">
      {error && <pre className="whitespace-pre-wrap font-mono text-[11px]">{error}</pre>}
      {renderedDetails && (
        <pre
          className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md p-2 font-mono text-[10px]"
          style={{ background: "var(--surface-2)" }}
        >
          {renderedDetails}
        </pre>
      )}
    </div>
  );
}

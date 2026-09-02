import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { Kpi, SectionHeading } from "@/components/report-ui";
import { ButtonLink, Notice, StatusPill } from "@/components/ui/primitives";
import {
  ArrowSquareOut,
  CheckCircle,
  Clock,
  Database,
  Info,
  WarningCircle,
  XCircle,
} from "@/components/ui/icons";
import {
  SOURCE_REGISTRY,
  getMonitoringHealth,
  type SourceHealthFact,
  type SourceRegistryEntry,
} from "@/lib/data";
import { parseLang, type Lang } from "@/lib/i18n";
import {
  sourceHealthState,
  summarizeSourceHealth,
  type SourceHealthStateKind,
} from "@/lib/source-health";
import { sourceRegistryPresentation } from "@/lib/source-labels";

export const dynamic = "force-dynamic";

type SourceStatusSearchParams = { lang?: string };

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SourceStatusSearchParams>;
}): Promise<Metadata> {
  const lang = parseLang((await searchParams).lang);
  return lang === "es"
    ? {
        title: "Fuentes y actualización",
        description:
          "Cobertura de fuentes oficiales de Oculis, fecha de actualización y límites conocidos.",
      }
    : {
        title: "Sources and freshness",
        description: "Oculis coverage of official sources, update times, and known limitations.",
      };
}

interface SourceRow {
  source: string;
  registry: SourceRegistryEntry | null;
  run: SourceHealthFact | null;
}

type SourceGroupKey = "legislative" | "regulatory" | "context" | "gaps" | "technical";

const GROUP_ORDER: readonly SourceGroupKey[] = [
  "legislative",
  "regulatory",
  "context",
  "gaps",
  "technical",
];

export default async function SourceStatusPage({
  searchParams,
}: {
  searchParams: Promise<SourceStatusSearchParams>;
}) {
  const lang: Lang = parseLang((await searchParams).lang);
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
  const health = summarizeSourceHealth(rows);
  const grouped = new Map<SourceGroupKey, SourceRow[]>(
    GROUP_ORDER.map((key) => [key, []] as const),
  );
  for (const row of rows) grouped.get(sourceGroup(row))!.push(row);

  return (
    <AppShell
      lang={lang}
      title={es ? "Fuentes y actualización" : "Sources and freshness"}
      subtitle={
        es
          ? "Qué consulta Oculis, cuándo se actualizó y dónde todavía existen límites"
          : "What Oculis checks, when it was updated, and where limits still exist"
      }
    >
      <section className="grid gap-6 border-b pb-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <div className="eyebrow text-[var(--accent)]">
            {es ? "Centro de confianza" : "Trust center"}
          </div>
          <h2 className="section-title mt-2 max-w-[30ch]">
            {es
              ? "Vea la evidencia y sus límites antes de usarla"
              : "Review the evidence and its limits before using it"}
          </h2>
          <p className="page-subtitle mt-3">
            {es
              ? "Cada tarjeta explica una conexión concreta. Un ciclo completo confirma que Oculis terminó esa consulta; no garantiza que la institución publique todos los campos posibles."
              : "Each card explains one connection. A complete cycle confirms that Oculis finished that check; it does not guarantee that the institution publishes every possible field."}
          </p>
        </div>
        <div className="notice max-w-md text-sm">
          <span className="flex items-start gap-2">
            <Info size={19} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--accent)]" />
            <span>
              {es
                ? "“Parcial” significa que Oculis conservó los hechos seguros y dejó sin completar lo que no pudo relacionar sin inferir."
                : "“Partial” means Oculis kept the safe facts and left unresolved anything it could not connect without inference."}
            </span>
          </span>
        </div>
      </section>

      <div
        className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-4"
        aria-label={es ? "Estado de fuentes requeridas" : "Required source health"}
      >
        <Kpi
          value={health.requiredTotal}
          label={es ? "Fuentes requeridas" : "Required sources"}
          accent="var(--accent)"
        />
        <Kpi
          value={health.requiredCurrent}
          label={es ? "Al día · requeridas" : "Current · required"}
          accent="var(--verified)"
        />
        <Kpi
          value={health.requiredAttention}
          label={es ? "Requieren atención" : "Need attention"}
          accent={health.requiredAttention === 0 ? "var(--verified)" : "var(--danger)"}
        />
        <Kpi
          value={health.requiredStale}
          label={es ? "Atrasadas · requeridas" : "Overdue · required"}
          accent={health.requiredStale === 0 ? "var(--verified)" : "var(--warn)"}
        />
      </div>

      <div className="mt-6 border-b pb-8">
        <Notice className="space-y-2 text-sm leading-relaxed">
          <p>
            {es
              ? "Al día = último ciclo requerido completo dentro de su plazo. Atención = ciclo parcial, fallido, en curso o todavía no ejecutado. Atrasada = el último ciclo completo ya excedió su plazo."
              : "Current = the latest required cycle completed within its deadline. Attention = partial, failed, running, or not yet run. Overdue = the latest complete cycle is past its deadline."}
          </p>
          <p>
            {es
              ? `${health.optionalTotal} conexiones opcionales (${health.optionalLimited} sin ciclo completo vigente) y ${health.knownGaps} brechas conocidas permanecen visibles por transparencia. No se cuentan como fallos de las fuentes requeridas.`
              : `${health.optionalTotal} optional connections (${health.optionalLimited} without a current complete cycle) and ${health.knownGaps} known gaps remain visible for transparency. They are not counted as required-source failures.`}
          </p>
        </Notice>
      </div>

      {GROUP_ORDER.map((key) => {
        const groupRows = grouped.get(key)!;
        if (groupRows.length === 0) return null;
        const copy = groupCopy(key, lang);
        return (
          <section key={key} aria-label={copy.title}>
            <SectionHeading title={copy.title} description={copy.description} />
            {key === "technical" ? (
              <details className="card overflow-hidden">
                <summary className="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-3 font-semibold sm:px-5">
                  <Database size={19} aria-hidden="true" className="text-[var(--accent)]" />
                  <span>
                    {es
                      ? `Mostrar ${groupRows.length} procesos internos`
                      : `Show ${groupRows.length} internal processes`}
                  </span>
                </summary>
                <div className="grid gap-3 border-t p-3 lg:grid-cols-2 sm:p-4">
                  {groupRows.map((row) => (
                    <SourceStatusCard key={row.source} row={row} lang={lang} />
                  ))}
                </div>
              </details>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {groupRows.map((row) => (
                  <SourceStatusCard key={row.source} row={row} lang={lang} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </AppShell>
  );
}

function SourceStatusCard({ row, lang }: { row: SourceRow; lang: Lang }) {
  const es = lang === "es";
  const missing = es ? "No informado" : "Not reported";
  const state = sourceHealthState(row, lang);
  const run = row.run;
  const latestRun = run?.finishedAt ?? run?.recordedAt;
  const presentation = row.registry ? sourceRegistryPresentation(row.registry, lang) : null;
  const contextSource = sourceGroup(row) === "context";
  const sourceAction = contextSource
    ? es
      ? "Abrir sitio de contexto"
      : "Open context site"
    : es
      ? "Abrir fuente oficial"
      : "Open official source";

  return (
    <article className="card min-w-0 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="serif text-lg font-semibold leading-snug">
            {presentation?.label ?? row.source}
          </h3>
          {row.registry && (
            <p className="mt-1 text-xs font-medium text-[var(--text-muted)]">
              {presentation?.owner}
            </p>
          )}
        </div>
        <StatusPill tone={state.tone} className="shrink-0">
          <SourceStateIcon kind={state.kind} />
          {state.label}
        </StatusPill>
      </div>

      <div className="mt-4">
        <div className="eyebrow">{es ? "Qué consulta Oculis" : "What Oculis checks"}</div>
        <p className="mt-1.5 text-sm leading-relaxed">
          {presentation?.coverage ??
            (es
              ? "Proceso registrado sin una descripción pública de cobertura."
              : "Recorded process without a public coverage description.")}
        </p>
      </div>

      <dl className="mt-4 grid gap-3 border-t pt-4 text-xs sm:grid-cols-2">
        <div>
          <dt className="eyebrow">{es ? "Frecuencia prevista" : "Expected frequency"}</dt>
          <dd className="mt-1.5">
            {row.registry ? cadenceLabel(row.registry.cadence, lang) : missing}
          </dd>
        </div>
        <div>
          <dt className="eyebrow">{es ? "Última ejecución" : "Latest run"}</dt>
          <dd className="mt-1.5">{formatRunDate(latestRun, lang, missing)}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="eyebrow">{es ? "Impacto en el estado" : "Health impact"}</dt>
          <dd className="mt-1.5">{sourceImpactLabel(row, lang)}</dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
        {row.registry?.officialUrl ? (
          <ButtonLink
            href={row.registry.officialUrl}
            external
            lang={lang}
            variant="quiet"
            ariaLabel={`${sourceAction}: ${presentation?.owner ?? row.registry.owner}. ${
              es ? "Abre en una pestaña nueva" : "Opens in a new tab"
            }`}
          >
            {sourceAction}
            <ArrowSquareOut size={17} aria-hidden="true" />
          </ButtonLink>
        ) : (
          <span className="text-xs text-[var(--text-muted)]">
            {es ? "Enlace oficial seguro no disponible" : "Secure official link unavailable"}
          </span>
        )}
      </div>

      <details className="mt-3 rounded-[var(--radius-md)] border px-3 py-2.5 text-xs">
        <summary className="flex min-h-[44px] cursor-pointer items-center font-semibold">
          {es ? "Ver límites y detalles" : "View limits and details"}
        </summary>
        <div className="mt-3 space-y-4 border-t pt-3">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="eyebrow">{es ? "Identificador" : "Identifier"}</dt>
              <dd className="mt-1 break-all font-mono text-[11px]">{row.source}</dd>
            </div>
            <div>
              <dt className="eyebrow">
                {es ? "Último ciclo registrado" : "Latest recorded cycle"}
              </dt>
              <dd className="mt-1">{formatRunDate(run?.recordedAt, lang, missing)}</dd>
            </div>
            <div>
              <dt className="eyebrow">{es ? "Último ciclo exitoso" : "Latest successful cycle"}</dt>
              <dd className="mt-1">{formatRunDate(run?.lastSuccessAt, lang, missing)}</dd>
            </div>
            <div>
              <dt className="eyebrow">
                {es ? "Último ciclo con datos" : "Latest cycle with data"}
              </dt>
              <dd className="mt-1">{formatRunDate(run?.lastDataAt, lang, missing)}</dd>
            </div>
          </dl>

          {row.registry?.status === "KNOWN_GAP" && (
            <Notice tone="warning" className="text-xs leading-relaxed">
              {presentation?.gapReason ?? row.registry.gapReason}
            </Notice>
          )}

          {run && (
            <details>
              <summary className="cursor-pointer font-semibold">
                {es ? "Datos técnicos de la ejecución" : "Technical run data"}
              </summary>
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <span>
                    {es ? "Vistos" : "Seen"}: {run.seen}
                  </span>
                  <span>
                    {es ? "Nuevos" : "New"}: {run.inserted}
                  </span>
                  <span>
                    {es ? "Actualizados" : "Updated"}: {run.updated}
                  </span>
                  <span>
                    {es ? "Cambios" : "Changes"}: {run.statusChanges}
                  </span>
                </div>
                <RunNotes error={run.error} details={run.details} missing={missing} />
              </div>
            </details>
          )}
        </div>
      </details>
    </article>
  );
}

function SourceStateIcon({ kind }: { kind: SourceHealthStateKind }) {
  const props = { size: 14, "aria-hidden": true } as const;
  if (kind === "complete") return <CheckCircle {...props} />;
  if (kind === "failed") return <XCircle {...props} />;
  if (kind === "stale" || kind === "partial") return <WarningCircle {...props} />;
  return <Clock {...props} />;
}

function sourceImpactLabel(row: SourceRow, lang: Lang): string {
  const es = lang === "es";
  if (row.registry?.status === "KNOWN_GAP") {
    return es
      ? "Brecha declarada · no altera el estado requerido"
      : "Declared gap · does not affect required health";
  }
  if (row.registry?.required) {
    return es
      ? "Requerida · sí afecta el estado operativo"
      : "Required · affects operational health";
  }
  if (row.registry) {
    return es
      ? "Opcional · visible, sin alterar el estado requerido"
      : "Optional · visible, does not affect required health";
  }
  return es
    ? "Proceso no declarado · fuera del indicador requerido"
    : "Undeclared process · outside required health";
}

function sourceGroup(row: SourceRow): SourceGroupKey {
  if (row.registry?.status === "KNOWN_GAP") return "gaps";
  if (row.source.startsWith("reg-")) return "regulatory";
  if (row.source.startsWith("feed-")) return "context";
  if (!row.registry || row.registry.owner === "Oculis") return "technical";
  return "legislative";
}

function groupCopy(key: SourceGroupKey, lang: Lang): { title: string; description: string } {
  const es = lang === "es";
  const copy: Record<SourceGroupKey, readonly [string, string, string, string]> = {
    legislative: [
      "Congreso y actividad legislativa",
      "Iniciativas, agendas, documentos, legisladores y comisiones de las dos cámaras.",
      "Congress and legislative activity",
      "Bills, agendas, documents, legislators, and committees from both chambers.",
    ],
    regulatory: [
      "Instituciones regulatorias",
      "Documentos y secciones públicas configuradas para el monitoreo regulatorio.",
      "Regulatory institutions",
      "Documents and public sections configured for regulatory monitoring.",
    ],
    context: [
      "Noticias y contexto",
      "Las noticias oficiales de las cámaras son requeridas; prensa y redes son contexto opcional y no alteran el indicador requerido.",
      "News and context",
      "Official chamber news is required; press and social sources are optional context and do not alter required health.",
    ],
    gaps: [
      "Cobertura todavía no disponible",
      "Información pública que Oculis no presenta porque aún no tiene una conexión suficientemente validada.",
      "Coverage not yet available",
      "Public information Oculis does not display because it does not yet have a sufficiently validated connection.",
    ],
    technical: [
      "Procesos internos",
      "Enlaces y señales que Oculis produce a partir de hechos ya almacenados. Se ocultan por defecto para simplificar la lectura.",
      "Internal processes",
      "Links and signals Oculis creates from already stored facts. Hidden by default to keep this page simple.",
    ],
  };
  const item = copy[key];
  return es ? { title: item[0], description: item[1] } : { title: item[2], description: item[3] };
}

function formatRunDate(value: string | null | undefined, lang: Lang, missing: string): string {
  if (!value) return missing;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return missing;
  return new Intl.DateTimeFormat(lang === "es" ? "es-DO" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Santo_Domingo",
  }).format(date);
}

function cadenceLabel(cadence: SourceRegistryEntry["cadence"], lang: Lang): string {
  const labels: Record<SourceRegistryEntry["cadence"], readonly [string, string]> = {
    THREE_TIMES_DAILY: ["3 veces al día", "3 times daily"],
    DAILY: ["Diaria", "Daily"],
    WEEKLY: ["Semanal", "Weekly"],
    BOOTSTRAP: ["Carga inicial", "Initial load"],
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
  if (!error && !renderedDetails) {
    return <span className="text-[var(--text-muted)]">{missing}</span>;
  }
  return (
    <div className="space-y-2 break-words">
      {error && <pre className="whitespace-pre-wrap font-mono text-[11px]">{error}</pre>}
      {renderedDetails && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--surface-2)] p-2 font-mono text-[10px]">
          {renderedDetails}
        </pre>
      )}
    </div>
  );
}

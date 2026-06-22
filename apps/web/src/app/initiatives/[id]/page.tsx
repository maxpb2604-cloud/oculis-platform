import Link from "next/link";
import { notFound } from "next/navigation";
import { CATEGORY_LABELS, type Category } from "@oculis/core";
import { getInitiative } from "@/lib/data";
import { dict, type Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { Panel, SectionHeading } from "@/components/dashboard";
import { RiskPill } from "@/components/initiatives-table";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { id } = await params;
  const lang: Lang = (await searchParams).lang === "en" ? "en" : "es";
  const t = dict[lang];
  const q = lang === "en" ? "?lang=en" : "";

  const ini = await getInitiative(Number(id));
  if (!ini) notFound();

  const prov = (ini.scoreInputs?.provenance ?? {}) as {
    rationale?: string;
    estimatedBy?: string;
    confidence?: number;
    sponsorApprovedCount?: number;
  };

  const meta: Array<[string, string | null]> = [
    [t.sponsor, ini.sponsor],
    [lang === "es" ? "Partido" : "Party", ini.party],
    [t.province, ini.province],
    [lang === "es" ? "Comisión" : "Committee", ini.committee],
    [lang === "es" ? "Tipo" : "Type", ini.type],
    [lang === "es" ? "Cámara" : "Chamber", ini.chamber],
    [lang === "es" ? "Depositada" : "Filed", ini.filedAt],
    [t.category, ini.category ? CATEGORY_LABELS[ini.category as Category] ?? ini.category : null],
  ];

  return (
    <AppShell lang={lang} title={lang === "es" ? "Detalle de Iniciativa" : "Initiative Detail"} subtitle={ini.code ?? ""}>
      <Link href={`/initiatives${q}`} className="text-xs hover:underline" style={{ color: "var(--accent)", cursor: "pointer" }}>
        {lang === "es" ? "← Volver a iniciativas" : "← Back to initiatives"}
      </Link>

      <div className="card mt-3 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="tnum font-mono text-xs" style={{ color: "var(--text-muted)" }}>{ini.code ?? "—"}</span>
          <RiskPill level={ini.riskLevel} />
          {ini.approvalProbability && (
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {lang === "es" ? "Aprobación" : "Approval"}: <strong>{ini.approvalProbability}</strong>
            </span>
          )}
          {ini.needsReview && (
            <span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ color: "var(--risk-medio)", background: "var(--risk-medio-soft)" }}>
              {lang === "es" ? "IA · pendiente de revisión" : "AI · pending review"}
            </span>
          )}
        </div>
        <h1 className="serif mt-3 text-2xl font-semibold leading-snug">{ini.title}</h1>
        {ini.purpose && <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>{ini.purpose}</p>}
        {ini.sourceUrl && (
          <a href={ini.sourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs hover:underline" style={{ color: "var(--accent)", cursor: "pointer" }}>
            {lang === "es" ? "Ver fuente oficial (SIL) ↗" : "View official source (SIL) ↗"}
          </a>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title={lang === "es" ? "Ficha" : "Details"}>
          <dl className="grid grid-cols-1 gap-y-3 text-sm sm:grid-cols-2 sm:gap-x-6">
            {meta.map(([k, v]) => (
              <div key={k}>
                <dt className="eyebrow">{k}</dt>
                <dd className="mt-0.5">{v ?? "—"}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel title={lang === "es" ? "Evaluación de Riesgo" : "Risk Assessment"}>
          {ini.scoreInputs ? (
            <div className="space-y-2 text-sm">
              <ScoreRow label={lang === "es" ? "Fuerza del partido" : "Party strength"} value={ini.scoreInputs.party} />
              <ScoreRow label={lang === "es" ? "Proyectos aprobados del proponente" : "Sponsor's approved bills"} value={`${prov.sponsorApprovedCount ?? 0}`} />
              <ScoreRow label={lang === "es" ? "Apoyo del Ejecutivo" : "Executive support"} value={ini.scoreInputs.executiveSupport} />
              <ScoreRow label={lang === "es" ? "Apoyo de stakeholders" : "Stakeholder support"} value={ini.scoreInputs.stakeholderSupport} />
              <ScoreRow label={lang === "es" ? "Presión social (0-20)" : "Public pressure (0-20)"} value={`${ini.scoreInputs.socialPressureCount ?? "—"}`} />
              <div className="hairline my-2" />
              <ScoreRow label={lang === "es" ? "Probabilidad de aprobación" : "Approval probability"} value={ini.approvalProbability} strong />
              <ScoreRow label={lang === "es" ? "Nivel de riesgo" : "Risk level"} value={ini.riskLevel} strong />
              {prov.rationale && (
                <p className="mt-3 rounded-lg p-3 text-xs leading-relaxed" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
                  <strong>{prov.estimatedBy === "claude" ? "IA" : (lang === "es" ? "Heurística" : "Heuristic")}:</strong> {prov.rationale}
                  {typeof prov.confidence === "number" && ` (${Math.round(prov.confidence * 100)}%)`}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>{lang === "es" ? "Sin evaluación." : "Not scored."}</p>
          )}
        </Panel>
      </div>

      <SectionHeading n="" title={lang === "es" ? "Historial de Estados" : "Status Timeline"} />
      <Panel title={lang === "es" ? "Cronología" : "Timeline"}>
        {ini.events.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>{lang === "es" ? "Sin eventos registrados." : "No events recorded."}</p>
        ) : (
          <ol className="relative ml-2 border-l pl-5">
            {ini.events.map((e) => (
              <li key={e.id} className="mb-4 last:mb-0">
                <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full" style={{ background: "var(--accent)" }} />
                <div className="tnum text-xs" style={{ color: "var(--text-muted)" }}>{e.eventDate ?? "—"}</div>
                <div className="text-sm font-medium">{e.status}</div>
                {e.note && <div className="text-xs" style={{ color: "var(--text-muted)" }}>{e.note}</div>}
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </AppShell>
  );
}

function ScoreRow({ label, value, strong }: { label: string; value: string | null; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <span className={strong ? "font-semibold" : ""}>{value ?? "—"}</span>
    </div>
  );
}

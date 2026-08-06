import {
  getChamberActivity,
  getCommissionsWithMembers,
  getMonitoringHealth,
  getOfficialPublicationDocuments,
} from "@/lib/data";
import type { Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { StatTile, type ActivityItem } from "@/components/monitoring";
import { AgendaBrowser } from "@/components/agenda-browser";
import { CommitteeBubbles } from "@/components/committee-bubbles";
import { OfficialPublications } from "@/components/official-publications";
import { formatISODate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SenadoPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const lang: Lang = (await searchParams).lang === "en" ? "en" : "es";
  const es = lang === "es";
  const [items, members, publications, health] = await Promise.all([
    getChamberActivity("SENADO", 200) as Promise<ActivityItem[]>,
    getCommissionsWithMembers("SENADO"),
    getOfficialPublicationDocuments("SENADO"),
    getMonitoringHealth(),
  ]);
  const pleno = items.filter((i) => i.scope === "PLENARY");
  const asamblea = items.filter((i) => i.scope === "ASAMBLEA");
  const comisiones = items.filter((i) => i.scope === "COMMITTEE");
  const asistencia = comisiones.filter((i) => i.source === "sen-attendance");
  const agendasComision = comisiones.filter((i) => i.source !== "sen-attendance");
  const votesRun = health.find((row) => row.source === "sen-votes") ?? null;
  const votesDetails =
    votesRun?.details && typeof votesRun.details === "object" && !Array.isArray(votesRun.details)
      ? (votesRun.details as Record<string, unknown>)
      : null;
  const votesEmptyMessage =
    typeof votesDetails?.emptyMessage === "string" && votesDetails.emptyMessage.trim()
      ? votesDetails.emptyMessage
      : null;

  return (
    <AppShell
      lang={lang}
      title={es ? "Senado de la República" : "Senate of the Republic"}
      subtitle={
        es
          ? "Pleno, Asamblea y comisiones · actividad reciente"
          : "Floor, Assembly & committees · recent activity"
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile value={items.length} label={es ? "Actividades" : "Activities"} />
        <StatTile
          value={pleno.length}
          label={es ? "Orden del día (Pleno)" : "Floor agenda"}
          accent="#3b82f6"
        />
        <StatTile value={asamblea.length} label={es ? "Asamblea" : "Assembly"} accent="#0d9488" />
        <StatTile
          value={agendasComision.length}
          label={es ? "Agenda comisiones" : "Committee agendas"}
          accent="#8b5cf6"
        />
        <StatTile
          value={asistencia.length}
          label={es ? "Registros de asistencia" : "Attendance records"}
          accent="#0f766e"
        />
        <StatTile
          value={publications.length}
          label={es ? "Documentos oficiales mostrados" : "Official documents shown"}
        />
      </div>

      <div className="mt-7">
        <h2 className="serif mb-3 text-lg font-semibold">{es ? "Comisiones" : "Committees"}</h2>
        <CommitteeBubbles
          items={agendasComision}
          lang={lang}
          chamber={es ? "Senado" : "Senate"}
          members={members}
        />
      </div>

      <div className="mt-8">
        <h2 className="serif mb-3 text-lg font-semibold">
          {es ? "Registros de asistencia a comisiones" : "Committee attendance records"}
        </h2>
        {asistencia.length > 0 ? (
          <ul className="card divide-y">
            {asistencia.map((item) => (
              <li key={item.id} className="px-5 py-3 text-sm">
                <div className="font-medium">{item.description}</div>
                <div className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {es ? "Fecha de reunión publicada" : "Published meeting date"}:{" "}
                  {formatISODate(item.eventDate, lang)}
                </div>
                {item.agendaUrl && (
                  <a
                    href={item.agendaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-xs font-medium underline-offset-2 hover:underline"
                    style={{ color: "var(--accent)" }}
                  >
                    {es ? "Ver documento de asistencia ↗" : "View attendance document ↗"}
                  </a>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="card px-5 py-6 text-sm" style={{ color: "var(--text-muted)" }}>
            {es
              ? "Esta conexión no contiene registros de asistencia almacenados."
              : "This connection contains no stored attendance records."}
          </div>
        )}
      </div>

      <div className="mt-8">
        <h2 className="serif mb-3 text-lg font-semibold">
          {es ? "Pleno y Asamblea" : "Floor & Assembly"}
        </h2>
        <AgendaBrowser
          lang={lang}
          sections={[
            {
              key: "pleno",
              title: es ? "Órdenes del día" : "Agendas",
              items: [...pleno, ...asamblea],
            },
          ]}
        />
      </div>

      <div className="mt-8">
        <h2 className="serif mb-1 text-lg font-semibold">
          {es ? "Publicaciones oficiales" : "Official publications"}
        </h2>
        <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
          {es
            ? "La sección oficial de origen se conserva literalmente. Agendas, asistencias e informes no cambian por sí solos el estado de un PDL; aprobadas y perimidas solo se registran cuando la sección o el PDF lo declara."
            : "The official source section is preserved literally. Agendas, attendance files, and reports do not change a bill status by themselves; approved and expired events are recorded only when the section or PDF states them."}
        </p>
        <OfficialPublications items={publications} lang={lang} />
        <section className="card mt-4 px-5 py-4">
          <h3 className="text-sm font-semibold">
            {es ? "Votaciones electrónicas" : "Electronic votes"}
          </h3>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            {es
              ? "Documentos observados en la última ejecución"
              : "Documents observed in latest run"}
            : {votesRun ? votesRun.seen : es ? "No informado" : "Not reported"}
          </p>
          <p className="mt-2 text-sm">
            {votesEmptyMessage ? (
              <>
                <span className="font-medium">
                  {es ? "Mensaje literal de la fuente:" : "Literal source message:"}
                </span>{" "}
                {votesEmptyMessage}
              </>
            ) : es ? (
              "Mensaje literal de la fuente: No informado"
            ) : (
              "Literal source message: Not reported"
            )}
          </p>
        </section>
      </div>

      <div className="card mt-6 p-4 text-[12px]" style={{ color: "var(--text-muted)" }}>
        <span className="font-semibold" style={{ color: "var(--text)" }}>
          {es ? "Nota de cobertura:" : "Coverage note:"}
        </span>{" "}
        {es
          ? "las fichas del Sistema de Gestión de Expedientes Digitales se enlazan mediante la consulta pública disponible cuando la fuente registra un IdExpediente; sin ese identificador, el enlace figura como No informado."
          : "Digital Records System files use the available public lookup when the source records an IdExpediente; without that identifier, the link is shown as Not reported."}
      </div>
    </AppShell>
  );
}

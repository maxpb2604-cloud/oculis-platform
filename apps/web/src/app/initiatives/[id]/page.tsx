import Link from "next/link";
import { notFound } from "next/navigation";
import { getInitiative } from "@/lib/data";
import { dict, langQuery, type Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { Panel, SectionHeading } from "@/components/report-ui";
import { positiveInteger, safeHttpUrl } from "@/lib/input";
import { formatISODate } from "@/lib/format";
import { statusEvidenceLabel } from "@/lib/status-events";

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
  const q = langQuery(lang);

  const parsedId = positiveInteger(id);
  if (parsedId == null) notFound();
  const ini = await getInitiative(parsedId);
  if (!ini) notFound();
  const missing = lang === "es" ? "No informado" : "Not reported";

  const meta: Array<[string, string | null]> = [
    [t.sponsor, ini.sponsor],
    [lang === "es" ? "Partido" : "Party", ini.party],
    [t.province, ini.province],
    [lang === "es" ? "Comisión" : "Committee", ini.committee],
    [lang === "es" ? "Tipo" : "Type", ini.type],
    [lang === "es" ? "Cámara" : "Chamber", ini.chamber],
    [lang === "es" ? "Depositada" : "Filed", ini.filedAt ? formatISODate(ini.filedAt, lang) : null],
    [
      lang === "es" ? "Vencimiento" : "Expiration",
      ini.expiresAt ? formatISODate(ini.expiresAt, lang) : null,
    ],
    [
      lang === "es" ? "Tema declarado por la fuente" : "Source-reported subject",
      ini.sourceCategory,
    ],
    [lang === "es" ? "Procedencia" : "Provenance", ini.source],
  ];

  return (
    <AppShell
      lang={lang}
      title={lang === "es" ? "Detalle de Iniciativa" : "Initiative Detail"}
      subtitle={ini.code ?? ""}
    >
      <Link
        href={`/initiatives${q}`}
        className="text-xs hover:underline"
        style={{ color: "var(--accent)", cursor: "pointer" }}
      >
        {lang === "es" ? "Volver a iniciativas" : "Back to initiatives"}
      </Link>

      <div className="card mt-3 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="tnum font-mono text-xs" style={{ color: "var(--text-muted)" }}>
            {ini.code ?? missing}
          </span>
          <span
            className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
            style={{ color: "var(--accent)", background: "var(--accent-soft)" }}
          >
            {ini.source}
          </span>
        </div>
        <h1 className="serif mt-3 text-2xl font-semibold leading-snug">{ini.title}</h1>
        {ini.purpose && (
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
            {ini.purpose}
          </p>
        )}
        {ini.sourceUrl ? (
          <a
            href={ini.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block text-xs hover:underline"
            style={{ color: "var(--accent)", cursor: "pointer" }}
          >
            {lang === "es" ? "Ver fuente oficial (SIL) ↗" : "View official source (SIL) ↗"}
          </a>
        ) : (
          <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
            {lang === "es" ? "Enlace oficial: No informado" : "Official link: Not reported"}
          </p>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4">
        <Panel title={lang === "es" ? "Ficha" : "Details"}>
          <dl className="grid grid-cols-1 gap-y-3 text-sm sm:grid-cols-2 sm:gap-x-6">
            {meta.map(([k, v]) => (
              <div key={k}>
                <dt className="eyebrow">{k}</dt>
                <dd className="mt-0.5">{v ?? missing}</dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Panel title={lang === "es" ? "Proponentes reportados" : "Reported sponsors"}>
          {ini.proponents.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {ini.proponents.map((proponent, index) => {
                const facts = [proponent.role, proponent.party, proponent.province]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <li key={`${proponent.name}-${index}`}>
                    <span className="font-medium">{proponent.name}</span>
                    {proponent.principal === true && (
                      <span className="ml-1.5 rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] font-medium">
                        {lang === "es" ? "Principal según la fuente" : "Principal per source"}
                      </span>
                    )}
                    {facts && (
                      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {facts}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {missing}
            </p>
          )}
        </Panel>
      </div>

      <SectionHeading n="" title={lang === "es" ? "Documentos oficiales" : "Official documents"} />
      <Panel
        title={lang === "es" ? "Archivos vinculados por la fuente" : "Files linked by the source"}
      >
        {ini.documents.length > 0 ? (
          <ul className="space-y-3">
            {ini.documents.map((document) => {
              const documentUrl = safeHttpUrl(document.url);
              const label = document.docType ?? document.sourceDocId ?? missing;
              return (
                <li key={document.id} className="text-sm">
                  {documentUrl ? (
                    <a
                      href={documentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium underline-offset-2 hover:underline"
                      style={{ color: "var(--accent)" }}
                    >
                      {label} ↗
                    </a>
                  ) : (
                    <span>{label}</span>
                  )}
                  <div className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                    {lang === "es" ? "Fuente" : "Source"}: {document.source} ·{" "}
                    {lang === "es" ? "Fecha de carga" : "Upload date"}:{" "}
                    {formatISODate(document.uploadedAt, lang)}
                    {document.modifiedAt && (
                      <>
                        {" "}
                        · {lang === "es" ? "Modificado" : "Modified"}:{" "}
                        {formatISODate(document.modifiedAt, lang)}
                      </>
                    )}
                  </div>
                  {document.sourceCategory && (
                    <div className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                      {lang === "es" ? "Sección oficial" : "Official section"}:{" "}
                      {document.sourceCategory}
                    </div>
                  )}
                  {document.sourceFragment && (
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer" style={{ color: "var(--accent)" }}>
                        {lang === "es"
                          ? "Ver fragmento literal registrado"
                          : "View stored literal fragment"}
                      </summary>
                      <pre
                        className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-md p-2 font-mono text-[10px]"
                        style={{ background: "var(--surface-2)" }}
                      >
                        {document.sourceFragment}
                      </pre>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {lang === "es" ? "Documentos: No informado" : "Documents: Not reported"}
          </p>
        )}
      </Panel>

      <SectionHeading n="" title={lang === "es" ? "Historial de Estados" : "Status Timeline"} />
      <Panel title={lang === "es" ? "Cronología" : "Timeline"}>
        {ini.events.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {lang === "es" ? "Sin eventos registrados." : "No events recorded."}
          </p>
        ) : (
          <ol className="relative ml-2 border-l pl-5">
            {ini.events.map((e) => (
              <li key={e.id} className="mb-4 last:mb-0">
                <span
                  className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full"
                  style={{ background: "var(--accent)" }}
                />
                <div className="text-sm font-medium">{e.status}</div>
                <div className="tnum text-xs" style={{ color: "var(--text-muted)" }}>
                  {e.evidenceType === "SOURCE_HISTORY" && e.eventDate ? (
                    <>
                      {lang === "es" ? "Fecha oficial" : "Official date"}:{" "}
                      <time dateTime={e.eventDate}>{formatISODate(e.eventDate, lang)}</time>
                    </>
                  ) : e.eventDate ? (
                    <>
                      {lang === "es"
                        ? "Fecha almacenada sin atribución"
                        : "Stored date without attribution"}
                      : <time dateTime={e.eventDate}>{formatISODate(e.eventDate, lang)}</time>
                    </>
                  ) : (
                    <>
                      {lang === "es" ? "Observado por Oculis" : "Observed by Oculis"}:{" "}
                      {e.observedAt ? <time dateTime={e.observedAt}>{e.observedAt}</time> : missing}
                    </>
                  )}
                </div>
                {e.note && (
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {e.note}
                  </div>
                )}
                <dl className="mt-1 grid gap-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                  <div>
                    <dt className="inline">{lang === "es" ? "Fuente" : "Source"}: </dt>
                    <dd className="inline" style={{ color: "var(--text)" }}>
                      {e.source}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">
                      {lang === "es" ? "Tipo de evidencia" : "Evidence type"}:{" "}
                    </dt>
                    <dd className="inline">{statusEvidenceLabel(e.evidenceType, lang)}</dd>
                  </div>
                  <div>
                    <dt className="inline">
                      {lang === "es" ? "Enlace de evidencia" : "Evidence link"}:{" "}
                    </dt>
                    <dd className="inline">
                      {e.sourceUrl ? (
                        <a
                          href={e.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium underline-offset-2 hover:underline"
                          style={{ color: "var(--accent)" }}
                        >
                          {lang === "es" ? "Abrir ↗" : "Open ↗"}
                        </a>
                      ) : (
                        missing
                      )}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </AppShell>
  );
}

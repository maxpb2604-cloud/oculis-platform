import Link from "next/link";
import { formatISODate } from "@/lib/format";
import type { Lang } from "@/lib/i18n";
import type { OfficialPublicationDocument } from "@/lib/data";
import { NewTabNotice } from "@/components/ui/primitives";

const SOURCE_LABELS: Record<string, { es: string; en: string }> = {
  "dip-known-agenda": {
    es: "Orden del día conocida por el Pleno",
    en: "Order of business considered by the floor",
  },
  "sen-approved": { es: "Iniciativas aprobadas", en: "Approved initiatives" },
  "sen-expired": { es: "Proyectos perimidos", en: "Expired initiatives" },
  "sen-attendance": { es: "Asistencia a comisiones", en: "Committee attendance" },
  "sen-reports": { es: "Informes para lectura", en: "Reports for reading" },
};

export function OfficialPublications({
  items,
  lang,
}: {
  items: OfficialPublicationDocument[];
  lang: Lang;
}) {
  const es = lang === "es";
  if (items.length === 0) {
    return (
      <div className="card px-5 py-8 text-center text-sm" role="status">
        <p style={{ color: "var(--text-muted)" }}>
          {es
            ? "Esta conexión todavía no contiene documentos de estas colecciones oficiales."
            : "This connection does not yet contain documents from these official collections."}
        </p>
        <Link
          href={es ? "/estado-fuentes" : "/estado-fuentes?lang=en"}
          className="mt-2 inline-block text-xs font-medium underline-offset-2 hover:underline"
          style={{ color: "var(--accent)" }}
        >
          {es ? "Ver estado de fuentes" : "View source status"}
        </Link>
      </div>
    );
  }

  const groups = new Map<string, OfficialPublicationDocument[]>();
  for (const item of items) {
    const group = groups.get(item.source) ?? [];
    group.push(item);
    groups.set(item.source, group);
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {[...groups].map(([source, documents]) => {
        const label = SOURCE_LABELS[source];
        return (
          <section key={source} className="card overflow-hidden">
            <div className="border-b px-5 py-3">
              <h3 className="text-sm font-semibold">
                {label ? (es ? label.es : label.en) : source}
              </h3>
              <p className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                {documents.length} {es ? "documentos mostrados" : "documents shown"}
              </p>
            </div>
            <ul>
              {documents.map((document) => (
                <li key={document.id} className="border-b px-5 py-3 last:border-0">
                  {document.url ? (
                    <a
                      href={document.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[13px] font-medium leading-snug underline-offset-2 hover:underline"
                      style={{ color: "var(--accent)" }}
                    >
                      {document.title ?? document.sourceDocId ?? (es ? "Documento" : "Document")}
                      <NewTabNotice lang={lang} />
                    </a>
                  ) : (
                    <span className="text-[13px] font-medium leading-snug">
                      {document.title ?? document.sourceDocId ?? (es ? "Documento" : "Document")}
                    </span>
                  )}
                  <div
                    className="mt-1 flex flex-wrap gap-x-3 text-[11px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {document.extension && <span>{document.extension.toUpperCase()}</span>}
                    {document.sourceCategory && <span>{document.sourceCategory}</span>}
                    {document.initiativeCode && (
                      <span>
                        {es ? "Código publicado" : "Published code"}: {document.initiativeCode} ·{" "}
                        {es ? "enlace único: No informado" : "unique link: Not reported"}
                      </span>
                    )}
                    <span>
                      {es ? "Fecha en el catálogo" : "Catalog date"}:{" "}
                      {document.catalogDate
                        ? formatISODate(document.catalogDate, lang)
                        : es
                          ? "No informado"
                          : "Not reported"}
                    </span>
                    {document.modifiedDate && (
                      <span>
                        {es ? "Modificado en la fuente" : "Modified at source"}:{" "}
                        {formatISODate(document.modifiedDate, lang)}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

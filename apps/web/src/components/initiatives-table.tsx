import { dict, type Lang } from "@/lib/i18n";
import type { InitiativeListItem } from "@/lib/data";

/** Shared, hairline-row initiative table. Rows link to the detail page. */
export function InitiativesTable({ rows, lang }: { rows: InitiativeListItem[]; lang: Lang }) {
  const t = dict[lang];
  const missing = lang === "es" ? "No informado" : "Not reported";
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">
          {lang === "es" ? "Listado de iniciativas legislativas" : "Legislative initiatives list"}
        </caption>
        <thead>
          <tr className="eyebrow border-b" style={{ background: "var(--surface-2)" }}>
            <th scope="col" className="px-5 py-2.5 font-semibold">{t.code}</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">{t.title}</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">{t.status}</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">{t.sponsor}</th>
            <th scope="col" className="px-5 py-2.5 font-semibold">{t.province}</th>
            <th scope="col" className="px-5 py-2.5 font-semibold">{lang === "es" ? "Fuente" : "Source"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className="border-b transition-colors hover:bg-[var(--surface-2)] focus-within:bg-[var(--surface-2)]"
            >
              <td className="tnum whitespace-nowrap px-5 py-2.5 font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                {r.code ?? missing}
              </td>
              <td className="max-w-[460px] px-3 py-2.5">
                <button
                  type="button"
                  data-initiative-id={r.id}
                  aria-haspopup="dialog"
                  aria-label={
                    lang === "es"
                      ? `Abrir iniciativa ${r.code ?? r.title}`
                      : `Open initiative ${r.code ?? r.title}`
                  }
                  className="min-w-0 truncate text-left underline-offset-2 hover:underline"
                >
                  {r.title}
                </button>
              </td>
              <td className="px-3 py-2.5" style={{ color: "var(--text-muted)" }}>
                {r.status ?? missing}
              </td>
              <td className="px-3 py-2.5" style={{ color: "var(--text-muted)" }}>
                {[r.sponsor, r.party].filter(Boolean).join(" · ") || missing}
              </td>
              <td className="px-5 py-2.5" style={{ color: "var(--text-muted)" }}>
                {r.province ?? missing}
              </td>
              <td className="px-5 py-2.5" style={{ color: "var(--text-muted)" }}>
                {r.sourceUrl ? (
                  <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: "var(--accent)" }}>
                    {lang === "es" ? "Abrir ficha oficial ↗" : "Open official record ↗"}
                  </a>
                ) : missing}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="px-5 py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                {lang === "es" ? "Sin resultados." : "No results."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

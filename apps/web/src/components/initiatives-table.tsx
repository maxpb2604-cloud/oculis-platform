import { CATEGORY_LABELS, type Category } from "@oculis/core";
import { dict, t as tr, type Lang } from "@/lib/i18n";

export interface Row {
  id: number;
  code: string | null;
  title: string;
  category: string | null;
  status: string | null;
  riskLevel: string | null;
  approvalProbability: string | null;
  sponsor: string | null;
  party: string | null;
  province: string | null;
  filedAt: string | null;
  sourceUrl: string | null;
  needsReview: boolean;
}

const RISK_TONE: Record<string, { fg: string; bg: string }> = {
  ALTO: { fg: "var(--risk-alto)", bg: "var(--risk-alto-soft)" },
  MEDIO: { fg: "var(--risk-medio)", bg: "var(--risk-medio-soft)" },
  BAJO: { fg: "var(--risk-bajo)", bg: "var(--risk-bajo-soft)" },
};

export function RiskPill({ level, lang }: { level: string | null; lang: Lang }) {
  const tone = level ? RISK_TONE[level] : undefined;
  if (!tone || !level) return <span style={{ color: "var(--text-muted)" }}>—</span>;
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
      style={{ color: tone.fg, background: tone.bg }}
    >
      {tr(lang, `risk${level}`)}
    </span>
  );
}

const APPROVAL_TONE: Record<string, { fg: string; bg: string }> = {
  ALTA: { fg: "var(--risk-bajo)", bg: "var(--risk-bajo-soft)" },
  MEDIA: { fg: "var(--risk-medio)", bg: "var(--risk-medio-soft)" },
  BAJA: { fg: "var(--text-muted)", bg: "var(--surface-2)" },
};

/** Probability-of-approval pill (ALTA / MEDIA / BAJA). */
export function ApprovalPill({ level, lang }: { level: string | null; lang: Lang }) {
  const tone = level ? APPROVAL_TONE[level] : undefined;
  if (!tone || !level) return <span style={{ color: "var(--text-muted)" }}>—</span>;
  return (
    <span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ color: tone.fg, background: tone.bg }}>
      {tr(lang, `approval${level}`)}
    </span>
  );
}

/**
 * Shared, hairline-row initiative table. Rows open the initiative modal (via the
 * `data-initiative-id` delegation in InitiativeModalHost); the modal links on to
 * the full detail page at /initiatives/[id].
 */
export function InitiativesTable({ rows, lang }: { rows: Row[]; lang: Lang }) {
  const t = dict[lang];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="eyebrow border-b" style={{ background: "var(--surface-2)" }}>
            <th className="px-5 py-2.5 font-semibold">{t.code}</th>
            <th className="px-3 py-2.5 font-semibold">{t.title}</th>
            <th className="px-3 py-2.5 font-semibold">{t.category}</th>
            <th className="px-3 py-2.5 font-semibold">{t.status}</th>
            <th className="px-3 py-2.5 font-semibold">{t.risk}</th>
            <th className="px-3 py-2.5 font-semibold">{t.approval}</th>
            <th className="px-5 py-2.5 font-semibold">{t.province}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              data-initiative-id={r.id}
              // Modal trigger: focusable + button role so keyboard users can open it
              // (Enter/Space handled by the delegated keydown in InitiativeModalHost).
              tabIndex={0}
              role="button"
              aria-label={r.title}
              className="cursor-pointer border-b transition-colors hover:bg-[var(--surface-2)] focus-visible:bg-[var(--surface-2)]"
            >
              <td className="tnum whitespace-nowrap px-5 py-2.5 font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                {r.code ?? "—"}
              </td>
              <td className="max-w-[460px] px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 truncate">{r.title}</span>
                </div>
              </td>
              <td className="px-3 py-2.5" style={{ color: "var(--text-muted)" }}>
                {r.category ? CATEGORY_LABELS[r.category as Category] ?? r.category : "—"}
              </td>
              <td className="px-3 py-2.5" style={{ color: "var(--text-muted)" }}>
                {r.status ?? "—"}
              </td>
              <td className="px-3 py-2.5">
                <RiskPill level={r.riskLevel} lang={lang} />
              </td>
              <td className="px-3 py-2.5">
                <ApprovalPill level={r.approvalProbability} lang={lang} />
              </td>
              <td className="px-5 py-2.5" style={{ color: "var(--text-muted)" }}>
                {r.province ?? "—"}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="px-5 py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                {lang === "es" ? "Sin resultados." : "No results."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

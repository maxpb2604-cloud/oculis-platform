/**
 * Phase 1 monitoring UI — shared building blocks for the daily activity dashboard.
 * Pure presentational server components; data comes from lib/data.ts.
 */
import { STAGE_META, normalizeStatus } from "@oculis/core";
import { t, type Lang } from "@/lib/i18n";
import { formatISODate, formatISODayMonth } from "@/lib/format";

export interface ActivityItem {
  id: number;
  scope: string;
  chamber: string | null;
  eventDate: string | null;
  kind: string | null;
  body: string | null;
  description: string;
  agendaUrl: string | null;
  statuses: string[] | null;
  initiativeCount: number;
}

const STAGE_COLOR: Record<string, string> = {
  slate: "#64748b", blue: "#3b82f6", violet: "#8b5cf6", amber: "#d97706",
  green: "#0b6e4f", teal: "#0d9488", rose: "#e11d48",
};

/** Small KPI tile (count + label). */
export function StatTile({ value, label, accent = "var(--accent)" }: { value: number | string; label: string; accent?: string }) {
  return (
    <div className="card elev p-4">
      <div className="tnum text-[28px] font-semibold leading-none">{value}</div>
      <div className="eyebrow mt-2">{label}</div>
      <div className="mt-2 h-[3px] w-8 rounded-full" style={{ background: accent }} />
    </div>
  );
}

/** Scope chip (Pleno / Asamblea / Comisión). Label is always text, not color-only. */
export function ScopeChip({ scope, lang = "es" }: { scope: string; lang?: Lang }) {
  const label = ["PLENARY", "ASAMBLEA", "COMMITTEE"].includes(scope) ? t(lang, `scope${scope}`) : scope;
  return (
    <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
      {label}
    </span>
  );
}

/** Status chip with self-explanatory tooltip. The label text always carries the
 *  meaning (never color-only); the dot is decorative (aria-hidden). */
export function StatusChip({ raw }: { raw: string }) {
  const meta = normalizeStatus(raw);
  const color = STAGE_COLOR[STAGE_META[meta.stage].color] ?? "#64748b";
  return (
    <span title={meta.tooltip} aria-label={`${meta.label}: ${meta.tooltip}`}
      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium"
      style={{ background: `${color}1a`, color }}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {meta.label}
    </span>
  );
}

/** One agenda/activity row. Composes structured fields — body (title), status chips,
 *  count chip, date — instead of re-printing a pre-baked description string. */
export function ActivityRow({ item, lang = "es" }: { item: ActivityItem; lang?: Lang }) {
  const statuses = item.statuses ?? [];
  // show description only when it adds detail beyond the body title
  const showDesc = item.description && item.description.trim() !== (item.body ?? "").trim();
  return (
    <div className="flex items-start gap-3 border-b px-5 py-3 last:border-0">
      <div className="pt-0.5"><ScopeChip scope={item.scope} lang={lang} /></div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-snug">{item.body}</div>
        {showDesc && (
          <div className="mt-0.5 text-[13px]" style={{ color: "var(--text-muted)" }}>{item.description}</div>
        )}
        {statuses.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {statuses.map((s, i) => <StatusChip key={i} raw={s} />)}
          </div>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
          {item.kind && <span>{item.kind}</span>}
          {item.initiativeCount > 0 && (
            <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-medium">
              {item.initiativeCount} {t(lang, item.initiativeCount === 1 ? "initiative" : "initiativePlural")}
            </span>
          )}
          {item.agendaUrl && (
            <a href={item.agendaUrl} target="_blank" rel="noreferrer"
              className="font-medium underline-offset-2 hover:underline" style={{ color: "var(--accent)" }}>
              {t(lang, "viewDocument")}
            </a>
          )}
        </div>
      </div>
      {item.eventDate && (
        <div className="tnum shrink-0 text-[11px]" style={{ color: "var(--text-muted)" }}>
          {formatISODayMonth(item.eventDate, lang)}
        </div>
      )}
    </div>
  );
}

/** A list of activity with empty state. */
export function ActivityList({ items, empty, lang = "es" }: { items: ActivityItem[]; empty: React.ReactNode; lang?: Lang }) {
  if (!items.length) {
    return <div role="status" className="px-5 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>{empty}</div>;
  }
  return <div>{items.map((i) => <ActivityRow key={i.id} item={i} lang={lang} />)}</div>;
}

// --- Daily deposits building blocks (the "depositadas hoy" feed) ---

export interface DepositItem {
  id: number;
  code: string | null;
  type: string | null;
  title: string; // SIL descripción — plain-language summary
  status: string | null;
  chamber: string | null;
  sourceId: string | null;
  sponsor: string | null;
  sponsorRole: string | null;
  sponsorCount: number | null;
  party: string | null;
  province: string | null;
  filedAt: string | null;
  sourceUrl: string | null;
  docUploaded: boolean;
  docUrl: string | null;
  docType: string | null;
}

/** Document-status pill — the "¿está cargado el PDF?" signal the user asked for. */
function DocStatus({ uploaded, senado, lang = "es" }: { uploaded: boolean; senado?: boolean; lang?: Lang }) {
  // The Senate's document registry is behind a login, so document availability can't be
  // verified publicly per-initiative — we flag it as "consult the portal" rather than
  // claiming pending/uploaded.
  const m = senado
    ? { bg: "var(--surface-2)", fg: "var(--text-muted)", label: t(lang, "docSenate") }
    : uploaded
      ? { bg: "var(--accent-soft)", fg: "var(--accent)", label: t(lang, "docFiled") }
      : { bg: "var(--warn-soft)", fg: "var(--warn)", label: t(lang, "docPending") };
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: m.bg, color: m.fg }}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: m.fg }} />
      {m.label}
    </span>
  );
}

/**
 * One deposited-initiative card: summary (descripción), who filed it (name + role +
 * party/province), and whether its official document is uploaded — linked to the SIL
 * page where it appears. Nothing more.
 */
export function DepositCard({ item, lang = "es" }: { item: DepositItem; lang?: Lang }) {
  const sponsorMeta = [item.party, item.province].filter(Boolean).join(" · ");
  const others = (item.sponsorCount ?? 1) - 1;
  const isSenado = item.chamber === "SENADO";
  return (
    <div data-initiative-id={item.id} className="flex cursor-pointer flex-col gap-2 border-b px-5 py-4 last:border-0 transition-colors hover:bg-[var(--surface-2)]">
      <div className="flex items-center gap-2">
        {item.code && (
          <span className="tnum rounded px-1.5 py-0.5 text-[11px] font-semibold"
            style={{ background: "var(--surface-2)" }}>{item.code}</span>
        )}
        {item.type && <span className="eyebrow">{item.type}</span>}
        {item.filedAt && (
          <span className="tnum ml-auto text-[11px]" style={{ color: "var(--text-muted)" }}>
            {formatISODate(item.filedAt, lang)}
          </span>
        )}
      </div>

      <div className="text-sm font-medium leading-snug">{item.title}</div>

      {item.sponsor && (
        <div className="flex flex-wrap items-center gap-x-1.5 text-[12px]" style={{ color: "var(--text-muted)" }}>
          <span>{t(lang, "filedBy")}</span>
          <span className="font-semibold" style={{ color: "var(--text)" }}>{item.sponsor}</span>
          {item.sponsorRole && <span>· {item.sponsorRole}</span>}
          {sponsorMeta && <span>· {sponsorMeta}</span>}
          {others > 0 && (
            <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-medium">
              +{others} {t(lang, others === 1 ? "coSponsors" : "coSponsorsPlural")}
            </span>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <DocStatus uploaded={item.docUploaded} senado={isSenado} lang={lang} />
        {isSenado && item.sourceId ? (
          <a href={`/api/senado/ficha/${item.sourceId}`} target="_blank" rel="noreferrer"
            className="text-[11px] font-medium underline-offset-2 hover:underline" style={{ color: "var(--accent)" }}>
            {t(lang, "openSenateRecord")}
          </a>
        ) : item.sourceUrl ? (
          <a href={item.sourceUrl} target="_blank" rel="noreferrer"
            className="text-[11px] font-medium underline-offset-2 hover:underline" style={{ color: "var(--accent)" }}>
            {t(lang, "viewSilRecord")}
          </a>
        ) : null}
        {!isSenado && item.docUploaded && item.docUrl && (
          <a href={item.docUrl} target="_blank" rel="noreferrer"
            className="text-[11px] font-medium underline-offset-2 hover:underline" style={{ color: "var(--accent)" }}>
            {t(lang, "openDocument")}
          </a>
        )}
      </div>
    </div>
  );
}

export function DepositList({ items, empty, lang = "es" }: { items: DepositItem[]; empty: React.ReactNode; lang?: Lang }) {
  if (!items.length) return <div role="status" className="px-5 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>{empty}</div>;
  return <div>{items.map((i) => <DepositCard key={i.id} item={i} lang={lang} />)}</div>;
}

// --- Regulatory monitoring building blocks ---

export interface RegulationItem {
  id: number;
  institution: string;
  regType: string | null;
  title: string;
  status: string | null;
  interventionLevel: string | null;
  category: string | null;
  isConsulta: boolean;
  publishedAt: string | null;
  deadline: string | null;
  url: string | null;
}

/** Today's date (YYYY-MM-DD) in the platform's timezone (America/Santo_Domingo). */
function todayInSantoDomingo(): string {
  // en-CA locale renders dates as YYYY-MM-DD, matching the stored ISO-day format.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santo_Domingo" }).format(new Date());
}

/**
 * Whether a public consultation is still open for comments: its deadline is today or
 * later in America/Santo_Domingo. Consultations without a parseable deadline are treated
 * as open (expiry can't be confirmed) — the UI simply shows no deadline for them.
 * Single source of truth for every "open consultations" KPI/list.
 */
export function isConsultaOpen(item: Pick<RegulationItem, "deadline">): boolean {
  if (!item.deadline) return true;
  const day = item.deadline.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return true;
  return day >= todayInSantoDomingo();
}

const INTERV_COLOR: Record<string, string> = {
  HIGH: "#0b6e4f",
  INTERMEDIATE: "#d97706",
  LOW: "#64748b",
};
const INTERV_KEYS: Record<string, { label: string; short: string }> = {
  HIGH: { label: "intervHigh", short: "intervHighShort" },
  INTERMEDIATE: { label: "intervMid", short: "intervMidShort" },
  LOW: { label: "intervLow", short: "intervLowShort" },
};

/** Possibility-of-intervention chip — the key regulatory signal (HIGH = act now).
 *  Unknown/null levels render a neutral "N/D" chip instead of claiming LOW. */
export function InterventionChip({ level, lang = "es" }: { level: string | null; lang?: Lang }) {
  const meta = level ? INTERV_KEYS[level] : undefined;
  if (!meta) {
    const label = lang === "es" ? "Sin evaluación" : "Not assessed";
    return (
      <span title={label} aria-label={label}
        className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold"
        style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
        <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--text-muted)" }} />
        N/D
      </span>
    );
  }
  const color = (level && INTERV_COLOR[level]) || "#64748b";
  const label = t(lang, meta.label);
  const short = t(lang, meta.short);
  return (
    <span title={label} aria-label={label}
      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: `${color}1a`, color }}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {short}
    </span>
  );
}

export function RegulationRow({ item, lang = "es" }: { item: RegulationItem; lang?: Lang }) {
  return (
    <div className="flex items-start gap-3 border-b px-5 py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{item.institution}</span>
          {item.regType && <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{item.regType}</span>}
          {item.isConsulta && (
            <span className="rounded px-1.5 py-0.5 text-[10px] font-bold"
              style={{ background: "var(--accent)", color: "#fff" }}>{t(lang, "publicConsultation")}</span>
          )}
        </div>
        <div className="mt-1 text-sm font-medium leading-snug">{item.title}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
          {item.status && <span>{item.status}</span>}
          {item.deadline && <span className="font-medium" style={{ color: "var(--warn)" }}>{t(lang, "deadline")}: {formatISODate(item.deadline, lang)}</span>}
          {item.url && (
            <a href={item.url} target="_blank" rel="noreferrer"
              className="font-medium underline-offset-2 hover:underline" style={{ color: "var(--accent)" }}>
              {t(lang, "viewDocument")}
            </a>
          )}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <InterventionChip level={item.interventionLevel} lang={lang} />
        {item.publishedAt && <div className="tnum mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>{formatISODate(item.publishedAt, lang)}</div>}
      </div>
    </div>
  );
}

export function RegulationList({ items, empty, lang = "es" }: { items: RegulationItem[]; empty: React.ReactNode; lang?: Lang }) {
  if (!items.length) return <div role="status" className="px-5 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>{empty}</div>;
  return <div>{items.map((i) => <RegulationRow key={i.id} item={i} lang={lang} />)}</div>;
}

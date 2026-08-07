/**
 * Phase 1 monitoring UI — shared building blocks for the daily activity dashboard.
 * Pure presentational server components; data comes from lib/data.ts.
 */
import Link from "next/link";
import { t, type Lang } from "@/lib/i18n";
import { formatISODate, formatISODayMonth } from "@/lib/format";
import { safeHttpUrl, senateRecordId } from "@/lib/input";

export interface ActivityItem {
  id: number;
  source: string;
  scope: string;
  chamber: string | null;
  eventDate: string | null;
  eventTime: string | null;
  kind: string | null;
  body: string | null;
  description: string;
  agendaUrl: string | null;
  statuses: string[] | null;
  initiativeCount: number;
  initiatives: Array<{
    code: string;
    initiativeId: number | null;
    title: string | null;
    sourceUrl: string | null;
  }>;
}

/** Every code explicitly mentioned by an activity row; ambiguous codes remain unlinked. */
export function ActivityInitiativeLinks({
  initiatives,
  lang = "es",
}: {
  initiatives: ActivityItem["initiatives"];
  lang?: Lang;
}) {
  if (initiatives.length === 0) return null;
  const missing = lang === "es" ? "Enlace: No informado" : "Link: Not reported";
  return (
    <ul className="mt-2 flex flex-col gap-1 text-[11px]">
      {initiatives.map((initiative) => {
        const label = [initiative.code, initiative.title].filter(Boolean).join(" — ");
        return (
          <li key={`${initiative.code}-${initiative.initiativeId ?? "unresolved"}`}>
            {initiative.initiativeId ? (
              <Link
                href={`/initiatives/${initiative.initiativeId}`}
                className="font-medium underline-offset-2 hover:underline"
                style={{ color: "var(--accent)" }}
              >
                {label}
              </Link>
            ) : (
              <span>
                {label} · <span style={{ color: "var(--text-muted)" }}>{missing}</span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Small KPI tile (count + label). */
export function StatTile({
  value,
  label,
  accent = "var(--accent)",
}: {
  value: number | string;
  label: string;
  accent?: string;
}) {
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
  const label = ["PLENARY", "ASAMBLEA", "COMMITTEE"].includes(scope)
    ? t(lang, `scope${scope}`)
    : scope;
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
    >
      {label}
    </span>
  );
}

/** Procedural phrase literally present in an agenda; never a bill lifecycle status. */
export function ProceduralMentionChip({ raw }: { raw: string }) {
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium"
      style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}
    >
      {raw}
    </span>
  );
}

/** One agenda/activity row. Composes structured fields — body (title), status chips,
 *  count chip, date — instead of re-printing a pre-baked description string. */
function ActivityRow({ item, lang = "es" }: { item: ActivityItem; lang?: Lang }) {
  const statuses = item.statuses ?? [];
  const agendaUrl = safeHttpUrl(item.agendaUrl);
  // show description only when it adds detail beyond the body title
  const showDesc = item.description && item.description.trim() !== (item.body ?? "").trim();
  return (
    <div className="flex items-start gap-3 border-b px-5 py-3 last:border-0">
      <div className="pt-0.5">
        <ScopeChip scope={item.scope} lang={lang} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-snug">{item.body}</div>
        {showDesc && (
          <div className="mt-0.5 text-[13px]" style={{ color: "var(--text-muted)" }}>
            {item.description}
          </div>
        )}
        {statuses.length > 0 && (
          <div className="mt-1.5">
            <div
              className="mb-1 text-[10px] font-semibold uppercase tracking-wide"
              style={{ color: "var(--text-muted)" }}
            >
              {lang === "es"
                ? "Menciones procedimentales en la agenda"
                : "Procedural mentions in the agenda"}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {statuses.map((s, i) => (
                <ProceduralMentionChip key={i} raw={s} />
              ))}
            </div>
          </div>
        )}
        <ActivityInitiativeLinks initiatives={item.initiatives} lang={lang} />
        <div
          className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]"
          style={{ color: "var(--text-muted)" }}
        >
          {item.kind && <span>{item.kind}</span>}
          {item.eventTime && (
            <span>
              {lang === "es" ? "Hora reportada" : "Reported time"}: {item.eventTime}
            </span>
          )}
          {item.initiativeCount > 0 && (
            <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-medium">
              {item.initiativeCount}{" "}
              {t(lang, item.initiativeCount === 1 ? "initiative" : "initiativePlural")}
            </span>
          )}
          {agendaUrl && (
            <a
              href={agendaUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium underline-offset-2 hover:underline"
              style={{ color: "var(--accent)" }}
            >
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
export function ActivityList({
  items,
  empty,
  lang = "es",
}: {
  items: ActivityItem[];
  empty: React.ReactNode;
  lang?: Lang;
}) {
  if (!items.length) {
    return (
      <div
        role="status"
        className="px-5 py-8 text-center text-sm"
        style={{ color: "var(--text-muted)" }}
      >
        {empty}
      </div>
    );
  }
  return (
    <div>
      {items.map((i) => (
        <ActivityRow key={i.id} item={i} lang={lang} />
      ))}
    </div>
  );
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
function DocStatus({
  uploaded,
  chamber,
  lang = "es",
}: {
  uploaded: boolean;
  chamber: string | null;
  lang?: Lang;
}) {
  // The Senate's document registry is behind a login, so document availability can't be
  // verified publicly per-initiative — we flag it as "consult the portal" rather than
  // claiming pending/uploaded.
  const m =
    chamber === "SENADO"
      ? { bg: "var(--surface-2)", fg: "var(--text-muted)", label: t(lang, "docSenate") }
      : chamber === "DIPUTADOS" && uploaded
        ? { bg: "var(--accent-soft)", fg: "var(--accent)", label: t(lang, "docFiled") }
        : chamber === "DIPUTADOS"
          ? { bg: "var(--surface-2)", fg: "var(--text-muted)", label: t(lang, "docPending") }
          : {
              bg: "var(--surface-2)",
              fg: "var(--text-muted)",
              label: lang === "es" ? "Documento: No informado" : "Document: Not reported",
            };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: m.bg, color: m.fg }}
    >
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
function DepositCard({ item, lang = "es" }: { item: DepositItem; lang?: Lang }) {
  const sponsorMeta = [item.party, item.province].filter(Boolean).join(" · ");
  const others = (item.sponsorCount ?? 1) - 1;
  const isSenado = item.chamber === "SENADO";
  const isDiputados = item.chamber === "DIPUTADOS";
  const senateId = isSenado ? senateRecordId(item.sourceId) : null;
  const sourceUrl = safeHttpUrl(item.sourceUrl);
  const docUrl = safeHttpUrl(item.docUrl);
  return (
    <div className="flex flex-col gap-2 border-b px-5 py-4 last:border-0 transition-colors hover:bg-[var(--surface-2)]">
      <div className="flex items-center gap-2">
        {item.code && (
          <span
            className="tnum rounded px-1.5 py-0.5 text-[11px] font-semibold"
            style={{ background: "var(--surface-2)" }}
          >
            {item.code}
          </span>
        )}
        {item.type && <span className="eyebrow">{item.type}</span>}
        {item.filedAt && (
          <span className="tnum ml-auto text-[11px]" style={{ color: "var(--text-muted)" }}>
            {formatISODate(item.filedAt, lang)}
          </span>
        )}
      </div>

      <button
        type="button"
        data-initiative-id={item.id}
        aria-haspopup="dialog"
        className="text-left text-sm font-medium leading-snug underline-offset-2 hover:underline"
        aria-label={`${lang === "es" ? "Abrir detalle de iniciativa" : "Open initiative detail"}: ${item.title}`}
      >
        {item.title}
      </button>

      {item.sponsor && (
        <div
          className="flex flex-wrap items-center gap-x-1.5 text-[12px]"
          style={{ color: "var(--text-muted)" }}
        >
          <span>{t(lang, "filedBy")}</span>
          <span className="font-semibold" style={{ color: "var(--text)" }}>
            {item.sponsor}
          </span>
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
        <DocStatus uploaded={item.docUploaded} chamber={item.chamber} lang={lang} />
        {senateId ? (
          <a
            href={`/api/senado/ficha/${senateId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-medium underline-offset-2 hover:underline"
            style={{ color: "var(--accent)" }}
          >
            {t(lang, "openSenateRecord")}
          </a>
        ) : sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-medium underline-offset-2 hover:underline"
            style={{ color: "var(--accent)" }}
          >
            {isDiputados
              ? t(lang, "viewSilRecord")
              : lang === "es"
                ? "Abrir fuente oficial"
                : "Open official source"}
          </a>
        ) : (
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {lang === "es" ? "Enlace oficial: No informado" : "Official link: Not reported"}
          </span>
        )}
        {isDiputados && item.docUploaded && docUrl && (
          <a
            href={docUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] font-medium underline-offset-2 hover:underline"
            style={{ color: "var(--accent)" }}
          >
            {t(lang, "openDocument")}
          </a>
        )}
      </div>
    </div>
  );
}

export function DepositList({
  items,
  empty,
  lang = "es",
}: {
  items: DepositItem[];
  empty: React.ReactNode;
  lang?: Lang;
}) {
  if (!items.length)
    return (
      <div
        role="status"
        className="px-5 py-8 text-center text-sm"
        style={{ color: "var(--text-muted)" }}
      >
        {empty}
      </div>
    );
  return (
    <div>
      {items.map((i) => (
        <DepositCard key={i.id} item={i} lang={lang} />
      ))}
    </div>
  );
}

// --- Regulatory monitoring building blocks ---

export interface RegulationItem {
  id: number;
  institution: string;
  regType: string | null;
  title: string;
  status: string | null;
  isConsulta: boolean | null;
  publishedAt: string | null;
  deadline: string | null;
  url: string | null;
}

function RegulationRow({ item, lang = "es" }: { item: RegulationItem; lang?: Lang }) {
  const sourceUrl = safeHttpUrl(item.url);
  const missing = lang === "es" ? "No informado" : "Not reported";
  const consultation =
    item.isConsulta == null ? missing : item.isConsulta ? (lang === "es" ? "Sí" : "Yes") : "No";
  return (
    <div className="flex items-start gap-3 border-b px-5 py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
          >
            {item.institution}
          </span>
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {lang === "es" ? "Tipo" : "Type"}: {item.regType ?? missing}
          </span>
          {item.isConsulta && (
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-bold"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              {t(lang, "publicConsultation")}
            </span>
          )}
        </div>
        <div className="mt-1 text-sm font-medium leading-snug">{item.title}</div>
        <div
          className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]"
          style={{ color: "var(--text-muted)" }}
        >
          <span>
            {lang === "es" ? "Estado" : "Status"}: {item.status ?? missing}
          </span>
          <span>
            {lang === "es" ? "Consulta pública" : "Public consultation"}: {consultation}
          </span>
          <span>
            {t(lang, "deadline")}: {item.deadline ?? missing}
          </span>
          {sourceUrl ? (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium underline-offset-2 hover:underline"
              style={{ color: "var(--accent)" }}
            >
              {t(lang, "viewDocument")}
            </a>
          ) : (
            <span>
              {lang === "es" ? "Enlace oficial: No informado" : "Official link: Not reported"}
            </span>
          )}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="tnum text-[11px]" style={{ color: "var(--text-muted)" }}>
          {lang === "es" ? "Fecha" : "Date"}: {item.publishedAt ?? missing}
        </div>
      </div>
    </div>
  );
}

export function RegulationList({
  items,
  empty,
  lang = "es",
}: {
  items: RegulationItem[];
  empty: React.ReactNode;
  lang?: Lang;
}) {
  if (!items.length)
    return (
      <div
        role="status"
        className="px-5 py-8 text-center text-sm"
        style={{ color: "var(--text-muted)" }}
      >
        {empty}
      </div>
    );
  return (
    <div>
      {items.map((i) => (
        <RegulationRow key={i.id} item={i} lang={lang} />
      ))}
    </div>
  );
}

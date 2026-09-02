/**
 * Phase 1 monitoring UI — shared building blocks for the daily activity dashboard.
 * Pure presentational server components; data comes from lib/data.ts.
 */
import Link from "next/link";
import { ArrowRight, ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";
import type { CSSProperties } from "react";
import { t, type Lang } from "@/lib/i18n";
import { formatISODate, formatISODayMonth, formatOfficialTime } from "@/lib/format";
import { safeHttpUrl } from "@/lib/input";
import { initiativeDetailHref } from "@/lib/initiative-links";
import {
  activityDestinationLabel,
  activityDetailHref,
  safeOfficialActivityUrl,
} from "@/lib/activity-links";
import { partyDisplayLabel } from "@/lib/party-presentation";
import { LegislatorProfileTrigger } from "@/components/legislator-profile-provider";
import { NewTabNotice } from "@/components/ui/primitives";
import type { PublicHoyDepositItem } from "@/lib/public-initiative-payloads";

export interface ActivityItem {
  id: number;
  source: string;
  sourceEventId: string | null;
  scope: string;
  chamber: string | null;
  eventDate: string | null;
  eventTime: string | null;
  location: string | null;
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
                href={initiativeDetailHref(initiative.initiativeId, lang)}
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

/** Committee rows always open Oculis' exact, shareable event record. External
 * destinations remain reserved for an exact official document or source record. */
export function ActivityDestinationLink({
  item,
  lang = "es",
  className,
  style,
}: {
  item: ActivityItem;
  lang?: Lang;
  className?: string;
  style?: CSSProperties;
}) {
  if (item.scope === "COMMITTEE" && item.source !== "sen-attendance") {
    return (
      <Link href={activityDetailHref(item.id, lang)} className={className} style={style}>
        <span className="inline-flex items-center gap-1.5">
          {lang === "es" ? "Ver agenda" : "View agenda"}
          <ArrowRight size={13} aria-hidden />
        </span>
      </Link>
    );
  }

  const agendaUrl = safeOfficialActivityUrl(item.agendaUrl, item.source, item.sourceEventId);
  if (!agendaUrl) return null;
  const label = activityDestinationLabel(agendaUrl, lang, item.source);
  return (
    <a
      href={agendaUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      style={style}
      aria-label={`${label}. ${
        lang === "es"
          ? "Abre la fuente oficial en una pestaña nueva"
          : "Opens the official source in a new tab"
      }`}
    >
      <span className="inline-flex items-center gap-1.5">
        {label}
        <ArrowSquareOut size={13} aria-hidden />
      </span>
    </a>
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
              {lang === "es" ? "Hora reportada" : "Reported time"}:{" "}
              {formatOfficialTime(item.eventTime, lang)}
            </span>
          )}
          {item.initiativeCount > 0 && (
            <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-medium">
              {item.initiativeCount}{" "}
              {t(lang, item.initiativeCount === 1 ? "initiative" : "initiativePlural")}
            </span>
          )}
          <ActivityDestinationLink
            item={item}
            lang={lang}
            className="font-medium underline-offset-2 hover:underline"
            style={{ color: "var(--accent)" }}
          />
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

/**
 * One deposited-initiative card: summary (descripción), who filed it (name + role +
 * party/province), and whether its official document is uploaded — linked to the SIL
 * page where it appears. Nothing more.
 */
export function DepositCard({ item, lang = "es" }: { item: PublicHoyDepositItem; lang?: Lang }) {
  const missing = lang === "es" ? "No informado" : "Not reported";
  const title = item.title.trim() || missing;
  const sponsorMeta = [partyDisplayLabel(item.party, null, lang), item.province]
    .filter(Boolean)
    .join(" · ");
  const others = (item.sponsorCount ?? 1) - 1;
  const sponsorIsLegislator = Boolean(
    item.sponsor &&
    (item.sponsorProfileId ||
      item.sponsorLegislatorSourceId ||
      /\b(?:diputad[oa]|senador(?:a)?)\b/i.test(item.sponsorRole ?? "")),
  );
  const isDiputados = item.chamber === "DIPUTADOS";
  const officialHref = item.officialRecordHref;
  const detailHref = initiativeDetailHref(item.id, lang);
  const documentHref = item.officialDocumentOpenHref;
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

      <div className="flex items-start gap-2">
        <Link
          href={detailHref}
          className="min-w-0 flex-1 text-left text-sm font-medium leading-snug underline-offset-2 hover:underline"
        >
          {title}
        </Link>
        <Link
          href={detailHref}
          className="inline-flex min-h-9 shrink-0 items-center rounded border px-2.5 py-1 text-[11px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ color: "var(--accent)" }}
          aria-label={`${lang === "es" ? "Ver detalle de la iniciativa" : "View initiative details"}: ${title}`}
        >
          {lang === "es" ? "Ver detalle" : "View details"}
        </Link>
      </div>

      {item.sponsor && (
        <div
          className="flex flex-wrap items-center gap-x-1.5 text-[12px]"
          style={{ color: "var(--text-muted)" }}
        >
          <span>{t(lang, "filedBy")}</span>
          {sponsorIsLegislator ? (
            <LegislatorProfileTrigger
              profileId={item.sponsorProfileId}
              fullName={item.sponsor}
              chamber={item.chamber}
              role={item.sponsorRole}
              party={item.party}
              province={item.province}
              className="-my-2 inline-flex min-h-11 items-center rounded-md px-2 font-semibold text-[var(--text)] underline-offset-4 hover:text-[var(--accent)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              {item.sponsor}
            </LegislatorProfileTrigger>
          ) : (
            <span className="font-semibold" style={{ color: "var(--text)" }}>
              {item.sponsor}
            </span>
          )}
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
        {officialHref ? (
          <a
            href={officialHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[11px] font-medium underline-offset-2 hover:underline"
            style={{ color: "var(--accent)" }}
            aria-label={`${isDiputados ? t(lang, "viewSilRecord") : t(lang, "openSenateRecord")}. ${
              lang === "es"
                ? "Abre la fuente oficial en una pestaña nueva"
                : "Opens the official source in a new tab"
            }`}
          >
            {isDiputados ? t(lang, "viewSilRecord") : t(lang, "openSenateRecord")}
            <ArrowSquareOut size={13} aria-hidden />
          </a>
        ) : (
          <span className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            {lang === "es" ? "Enlace oficial: No informado" : "Official link: Not reported"}
          </span>
        )}
        {isDiputados && documentHref ? (
          <a
            href={documentHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 text-[11px] font-medium underline-offset-2 hover:underline"
            style={{ color: "var(--accent)" }}
            aria-label={
              lang === "es"
                ? `Abrir el PDF oficial de ${item.code || title}. Abre la fuente oficial en una pestaña nueva`
                : `Open the official PDF for ${item.code || title}. Opens the official source in a new tab`
            }
          >
            {lang === "es" ? "Abrir PDF oficial" : "Open official PDF"}
            <ArrowSquareOut size={13} aria-hidden />
            <NewTabNotice lang={lang} />
          </a>
        ) : (
          <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
            {lang === "es" ? "PDF no disponible" : "PDF unavailable"}
          </span>
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
  items: PublicHoyDepositItem[];
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

export function RegulationRow({ item, lang = "es" }: { item: RegulationItem; lang?: Lang }) {
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
              className="rounded px-1.5 py-0.5 text-xs font-bold"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              {t(lang, "publicConsultation")}
            </span>
          )}
        </div>
        <div className="mt-1 text-sm font-medium leading-snug">{item.title}</div>
        <div
          className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] leading-5"
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
              className="inline-flex min-h-[44px] items-center font-semibold underline-offset-2 hover:underline"
              style={{ color: "var(--accent)" }}
              aria-label={`${t(lang, "viewDocument")}: ${item.title}, ${item.institution}. ${
                lang === "es"
                  ? "Abre la fuente oficial en una pestaña nueva"
                  : "Opens the official source in a new tab"
              }`}
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
        <div className="tnum text-[13px]" style={{ color: "var(--text-muted)" }}>
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

// --- Health (Estado de monitoreo) building blocks ---

/** OK / WARN / ERROR pill using design tokens (dark-mode safe). */
export function HealthPill({
  state,
  children,
}: {
  state: "ok" | "warn" | "error";
  children: React.ReactNode;
}) {
  const map = {
    ok: { bg: "var(--accent-soft)", fg: "var(--accent)" },
    warn: { bg: "var(--warn-soft)", fg: "var(--warn)" },
    error: { bg: "var(--danger-soft)", fg: "var(--danger)" },
  }[state];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: map.bg, color: map.fg }}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: map.fg }} />
      {children}
    </span>
  );
}

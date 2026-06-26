import Link from "next/link";
import { CATEGORY_LABELS, type Category } from "@oculis/core";
import { type Lang } from "@/lib/i18n";
import { shortBillName } from "@/lib/format";
import type { FeedListItem, FeedTag } from "@/lib/data";

/** Chip text: bill NAME for initiatives (more identifiable than the code), else the label. */
function tagDisplay(tag: FeedTag): string {
  return tag.entityType === "INITIATIVE"
    ? shortBillName(tag.initiativeTitle, tag.initiativeCode)
    : tag.label;
}

/** Per-kind badge styling (theme-aware tokens). */
const KIND_STYLE: Record<string, { es: string; en: string; fg: string; bg: string }> = {
  OFFICIAL: { es: "Oficial", en: "Official", fg: "var(--accent)", bg: "var(--accent-soft)" },
  NEWS: { es: "Prensa", en: "Press", fg: "var(--text-muted)", bg: "var(--surface-2)" },
  SOCIAL: { es: "Redes", en: "Social", fg: "var(--warn)", bg: "var(--warn-soft)" },
  LEGISLATIVE: {
    es: "Congreso",
    en: "Congress",
    fg: "var(--risk-bajo)",
    bg: "var(--risk-bajo-soft)",
  },
};

/** Friendly outlet/source label. */
const SOURCE_LABEL: Record<string, string> = {
  "feed-senado": "Senado",
  "feed-diputados": "Cámara de Diputados",
  "feed-diariolibre": "Diario Libre",
  "feed-listin": "Listín Diario",
  "feed-acento": "Acento",
  "feed-elnacional": "El Nacional",
  "feed-hoy": "Hoy",
  "feed-elcaribe": "El Caribe",
  "feed-x": "X",
  "feed-legislative": "Señal legislativa",
};

function fmtDate(iso: string | null, lang: Lang): string {
  if (!iso) return "";
  let s = iso.replace(" ", "T");
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(s)) s += "Z";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(lang === "es" ? "es-DO" : "en-US", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Santo_Domingo",
    }).format(d);
  } catch {
    return "";
  }
}

/** Build a /feed URL filtered to one entity, preserving language. */
function entityHref(tag: FeedTag, lang: Lang): string {
  const p = new URLSearchParams();
  if (tag.entityType === "INITIATIVE" && tag.initiativeCode)
    p.set("initiativeCode", tag.initiativeCode);
  else if (tag.entityType === "LEGISLATOR" && tag.legislatorSourceId)
    p.set("legislatorSourceId", tag.legislatorSourceId);
  else if (tag.entityType === "COMMISSION" && tag.commissionName)
    p.set("commissionName", tag.commissionName);
  if (lang === "en") p.set("lang", "en");
  return `/feed?${p.toString()}`;
}

const TAG_ICON: Record<string, string> = { INITIATIVE: "🏛", LEGISLATOR: "👤", COMMISSION: "🗂" };

export function FeedCard({ item, lang }: { item: FeedListItem; lang: Lang }) {
  const es = lang === "es";
  const k = KIND_STYLE[item.kind] ?? KIND_STYLE.NEWS!;
  const sourceName = item.handle ?? SOURCE_LABEL[item.source] ?? item.source;
  const when = fmtDate(item.publishedAt, lang);
  const catLabel = item.category
    ? (CATEGORY_LABELS[item.category as Category] ?? item.category)
    : null;

  return (
    <article className="card overflow-hidden transition-shadow hover:shadow-lg">
      <div className="flex gap-3 p-3.5">
        {item.imageUrl && (
          <div
            className="hidden h-[84px] w-[112px] shrink-0 rounded-lg sm:block"
            style={{
              backgroundImage: `url("${item.imageUrl}")`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              background: `var(--surface-2) url("${item.imageUrl}") center/cover no-repeat`,
            }}
            role="img"
            aria-label={item.title}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ color: k.fg, background: k.bg }}
            >
              {es ? k.es : k.en}
            </span>
            <span
              className="truncate text-[11.5px] font-medium"
              style={{ color: "var(--text-muted)" }}
            >
              {sourceName}
            </span>
            {when && (
              <span className="tnum text-[11px]" style={{ color: "var(--text-muted)" }}>
                · {when}
              </span>
            )}
            {catLabel && (
              <span
                className="ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium"
                style={{ color: "var(--accent)", background: "var(--accent-soft)" }}
              >
                {catLabel}
              </span>
            )}
          </div>

          {item.url ? (
            <a href={item.url} target="_blank" rel="noreferrer" className="block">
              <h3 className="serif text-[15.5px] font-semibold leading-snug hover:underline">
                {item.title}
              </h3>
            </a>
          ) : (
            <h3 className="serif text-[15.5px] font-semibold leading-snug">{item.title}</h3>
          )}

          {item.summary && (
            <p
              className="mt-1 line-clamp-2 text-[13px] leading-relaxed"
              style={{ color: "var(--text-muted)" }}
            >
              {item.summary}
            </p>
          )}

          {item.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.tags.slice(0, 6).map((tag, i) => (
                <Link
                  key={`${tag.entityType}-${tag.label}-${i}`}
                  href={entityHref(tag, lang)}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium transition-colors hover:bg-[var(--accent-soft)]"
                  style={{ background: "var(--surface-2)", color: "var(--text)" }}
                  title={
                    tag.entityType === "INITIATIVE" && tag.initiativeTitle
                      ? tag.initiativeTitle
                      : es
                        ? "Ver todo lo relacionado"
                        : "See everything related"
                  }
                >
                  <span aria-hidden>{TAG_ICON[tag.entityType] ?? "•"}</span>
                  <span className="max-w-[240px] truncate">{tagDisplay(tag)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

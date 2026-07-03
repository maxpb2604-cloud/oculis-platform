"use client";

import Link from "next/link";
import { CATEGORY_LABELS, type Category } from "@oculis/core";
import { type Lang } from "@/lib/i18n";
import { shortBillName, safeHref } from "@/lib/format";
import type { FeedListItem, FeedTag, FeedFilters } from "@/lib/data";

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

/** Friendly outlet/source label (only ids the scraper adapters actually produce). */
const SOURCE_LABEL: Record<string, string> = {
  "feed-senado": "Senado",
  "feed-diputados": "Cámara de Diputados",
  "feed-diariolibre": "Diario Libre",
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

type EntityFilterKey = "initiativeCode" | "legislatorSourceId" | "commissionName";

/**
 * The filter (param, value) this TAG's own identity maps to — the only entity
 * params the /api/feed → getFeed → listFeedItems chain supports. Built from the
 * tag itself (each tag carries its own ids), never from the item's primary
 * entity columns, so secondary-tag chips filter by the right entity.
 */
function tagParam(tag: FeedTag): { key: EntityFilterKey; value: string } | null {
  if (tag.entityType === "INITIATIVE") {
    const code = tag.initiativeCode ?? tag.label;
    return code ? { key: "initiativeCode", value: code } : null;
  }
  if (tag.entityType === "LEGISLATOR") {
    return tag.legislatorSourceId
      ? { key: "legislatorSourceId", value: tag.legislatorSourceId }
      : null;
  }
  if (tag.entityType === "COMMISSION") {
    const name = tag.commissionName ?? tag.label;
    return name ? { key: "commissionName", value: name } : null;
  }
  return null;
}

/** Build a /feed URL filtered to one entity, preserving language. */
function entityHref(param: { key: EntityFilterKey; value: string }, lang: Lang): string {
  const p = new URLSearchParams();
  p.set(param.key, param.value);
  if (lang === "en") p.set("lang", "en");
  return `/feed?${p.toString()}`;
}

const TAG_ICON: Record<string, string> = { INITIATIVE: "🏛", LEGISLATOR: "👤", COMMISSION: "🗂" };

export function FeedCard({
  item,
  lang,
  activeFilters,
}: {
  item: FeedListItem;
  lang: Lang;
  /** Currently-active feed filters — used to highlight the chip whose entity filter is on. */
  activeFilters?: Pick<FeedFilters, EntityFilterKey>;
}) {
  const es = lang === "es";
  const k = KIND_STYLE[item.kind] ?? KIND_STYLE.NEWS!;
  // Prefer a friendly outlet label; for Google-News press the outlet is in `author`.
  const sourceName = SOURCE_LABEL[item.source] ?? item.handle ?? item.author ?? item.source;
  const when = fmtDate(item.publishedAt, lang);
  const catLabel = item.category
    ? (CATEGORY_LABELS[item.category as Category] ?? item.category)
    : null;

  return (
    <article className="card overflow-hidden transition-shadow hover:shadow-lg">
      <div className="flex gap-3 p-3.5">
        {item.imageUrl && (
          // Plain lazy <img> on purpose: thumbnails come from arbitrary press hosts,
          // which next/image would need per-domain allowlisting for.
          <img
            src={item.imageUrl}
            alt=""
            loading="lazy"
            width={112}
            height={84}
            className="hidden h-[84px] w-[112px] shrink-0 rounded-lg object-cover sm:block"
            style={{ background: "var(--surface-2)" }}
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
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

          {safeHref(item.url) ? (
            <a href={safeHref(item.url)} target="_blank" rel="noopener noreferrer" className="block">
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
              {item.tags.slice(0, 6).map((tag, i) => {
                const key = `${tag.entityType}-${tag.label}-${i}`;
                const chipBody = (
                  <>
                    <span aria-hidden>{TAG_ICON[tag.entityType] ?? "•"}</span>
                    <span className="max-w-[240px] truncate">{tagDisplay(tag)}</span>
                  </>
                );
                const param = tagParam(tag);
                // No filterable identity on this tag → plain chip, not a link to
                // an unfiltered (or wrongly-filtered) feed.
                if (!param) {
                  return (
                    <span
                      key={key}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium"
                      style={{ background: "var(--surface-2)", color: "var(--text)" }}
                    >
                      {chipBody}
                    </span>
                  );
                }
                const active = activeFilters?.[param.key] === param.value;
                return (
                  <Link
                    key={key}
                    href={entityHref(param, lang)}
                    aria-current={active ? "true" : undefined}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium transition-colors hover:bg-[var(--accent-soft)]"
                    style={{
                      background: active ? "var(--accent-soft)" : "var(--surface-2)",
                      color: active ? "var(--accent)" : "var(--text)",
                    }}
                    title={
                      tag.entityType === "INITIATIVE" && tag.initiativeTitle
                        ? tag.initiativeTitle
                        : es
                          ? "Ver todo lo relacionado"
                          : "See everything related"
                    }
                  >
                    {chipBody}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

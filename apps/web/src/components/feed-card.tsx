import Link from "next/link";
import {
  ArrowRight,
  ArrowSquareOut,
  Buildings,
  CheckCircle,
  Newspaper,
  Radio,
} from "@phosphor-icons/react/dist/ssr";
import { type Lang } from "@/lib/i18n";
import { safeHttpUrl } from "@/lib/input";
import type { FeedListItem, FeedTag } from "@/lib/data";
import { initiativeDetailHref } from "@/lib/initiative-links";
import { feedSourceLabel } from "@/lib/source-labels";
import { NewTabNotice } from "@/components/ui/primitives";
import { LegislatorProfileTrigger } from "@/components/legislator-profile-provider";

/** Chip text: bill NAME for initiatives (more identifiable than the code), else the label. */
function tagDisplay(tag: FeedTag): string {
  return tag.entityType === "INITIATIVE"
    ? (tag.initiativeTitle ?? tag.initiativeCode ?? tag.label)
    : tag.label;
}

/** Per-kind badge styling (theme-aware tokens). */
const KIND_STYLE: Record<string, { es: string; en: string; fg: string; bg: string }> = {
  OFFICIAL: {
    es: "Publicación oficial",
    en: "Official publication",
    fg: "var(--accent)",
    bg: "var(--accent-soft)",
  },
  NEWS: {
    es: "Prensa y contexto",
    en: "Press and context",
    fg: "var(--text-muted)",
    bg: "var(--surface-2)",
  },
  SOCIAL: { es: "Cuenta pública", en: "Public account", fg: "var(--warn)", bg: "var(--warn-soft)" },
  LEGISLATIVE: {
    es: "Cambio verificado",
    en: "Verified change",
    fg: "var(--verified)",
    bg: "var(--verified-soft)",
  },
};

const ENTITY_LABEL: Record<string, { es: string; en: string }> = {
  INITIATIVE: { es: "Proyecto", en: "Bill" },
  LEGISLATOR: { es: "Legislador", en: "Legislator" },
  COMMISSION: { es: "Comisión", en: "Committee" },
};

function fmtDate(iso: string | null, lang: Lang): string {
  const missing = lang === "es" ? "No informado" : "Not reported";
  if (!iso) return missing;
  let s = iso.replace(" ", "T");
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(s)) s += "Z";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return missing;
  try {
    return new Intl.DateTimeFormat(lang === "es" ? "es-DO" : "en-US", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Santo_Domingo",
    }).format(d);
  } catch {
    return missing;
  }
}

/** Build a /feed URL filtered to one entity, preserving language. */
function entityHref(tag: FeedTag, lang: Lang): string {
  if (tag.entityType === "INITIATIVE" && tag.initiativeId) {
    return initiativeDetailHref(tag.initiativeId, lang);
  }
  const p = new URLSearchParams();
  if (tag.entityType === "INITIATIVE" && tag.initiativeCode)
    p.set("initiativeCode", tag.initiativeCode);
  else if (tag.entityType === "COMMISSION" && tag.commissionName)
    p.set("commissionName", tag.commissionName);
  if (lang === "en") p.set("lang", "en");
  return `/feed?${p.toString()}`;
}

export function FeedCard({ item, lang }: { item: FeedListItem; lang: Lang }) {
  const es = lang === "es";
  const k =
    KIND_STYLE[item.kind] ??
    ({
      es: item.kind || "No informado",
      en: item.kind || "Not reported",
      fg: "var(--text-muted)",
      bg: "var(--surface-2)",
    } satisfies (typeof KIND_STYLE)[string]);
  // Prefer a friendly outlet label; for Google-News press the outlet is in `author`.
  const sourceName = feedSourceLabel(item.source, lang, item.handle ?? item.author ?? item.source);
  const when = fmtDate(item.publishedAt ?? item.observedAt, lang);
  const whenLabel = item.publishedAt
    ? es
      ? "Publicado"
      : "Published"
    : es
      ? "Registrado"
      : "Recorded";
  const activityMatch =
    item.source === "feed-legislative" ? /^activity:(\d+)$/.exec(item.sourceId) : null;
  const activityId = activityMatch ? Number(activityMatch[1]) : null;
  const initiativeTag = item.tags.find(
    (tag) => tag.entityType === "INITIATIVE" && tag.initiativeId,
  );
  const initiativeHref = initiativeTag?.initiativeId
    ? initiativeDetailHref(initiativeTag.initiativeId, lang)
    : null;
  const itemUrl = safeHttpUrl(item.url);
  const imageUrl = safeHttpUrl(item.imageUrl);
  const marker = item.title.lastIndexOf(" → ");
  const title = marker >= 0 ? item.title.slice(0, marker).trim() : item.title;
  const reportedStatus = marker >= 0 ? item.title.slice(marker + 3).trim() : null;
  const detailHref =
    activityId && Number.isSafeInteger(activityId) && activityId > 0
      ? (() => {
          const params = new URLSearchParams({ returnTo: "actualidad" });
          if (!es) params.set("lang", "en");
          return `/agenda/${activityId}?${params.toString()}`;
        })()
      : initiativeHref;
  const KindIcon =
    item.kind === "LEGISLATIVE"
      ? CheckCircle
      : item.kind === "NEWS"
        ? Newspaper
        : item.kind === "SOCIAL"
          ? Radio
          : Buildings;
  const titleStyle = {
    display: "-webkit-box",
    WebkitBoxOrient: "vertical" as const,
    WebkitLineClamp: 3,
    overflow: "hidden",
  };

  return (
    <article className="border-b py-5 first:pt-0 last:border-0">
      <div className="flex gap-4">
        <KindIcon
          size={25}
          weight={item.kind === "LEGISLATIVE" ? "regular" : "light"}
          className="mt-0.5 shrink-0"
          style={{ color: k.fg }}
          aria-hidden
        />
        {imageUrl && (
          <div
            className="order-last hidden h-[92px] w-[126px] shrink-0 rounded-lg sm:block"
            style={{
              backgroundImage: `url("${imageUrl}")`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              background: `var(--surface-2) url("${imageUrl}") center/cover no-repeat`,
            }}
            role="img"
            aria-label={item.title}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
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
            <span className="tnum text-[11px]" style={{ color: "var(--text-muted)" }}>
              · {whenLabel}: {when}
            </span>
          </div>

          {detailHref ? (
            <Link href={detailHref} className="block">
              <h3
                className="serif text-lg font-semibold leading-snug hover:underline"
                style={titleStyle}
                title={title}
              >
                {title}
              </h3>
            </Link>
          ) : itemUrl ? (
            <a href={itemUrl} target="_blank" rel="noreferrer" className="block">
              <h3
                className="serif text-lg font-semibold leading-snug hover:underline"
                style={titleStyle}
                title={title}
              >
                {title}
              </h3>
              <NewTabNotice lang={lang} />
            </a>
          ) : (
            <h3
              className="serif text-lg font-semibold leading-snug"
              style={titleStyle}
              title={title}
            >
              {title}
            </h3>
          )}

          {reportedStatus && (
            <p className="mt-2 text-[13px]" style={{ color: "var(--text-muted)" }}>
              {es ? "Estado oficial informado: " : "Reported official status: "}
              <strong style={{ color: "var(--text)", fontWeight: 600 }}>{reportedStatus}</strong>
            </p>
          )}

          {item.summary && item.kind !== "LEGISLATIVE" && (
            <p
              className="mt-2 line-clamp-2 text-[13px] leading-relaxed"
              style={{ color: "var(--text-muted)" }}
            >
              {item.summary}
            </p>
          )}

          {item.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {item.tags.slice(0, 4).map((tag, i) => {
                const content = (
                  <span className="max-w-[280px] truncate">
                    {es
                      ? (ENTITY_LABEL[tag.entityType]?.es ?? tag.entityType)
                      : (ENTITY_LABEL[tag.entityType]?.en ?? tag.entityType)}{" "}
                    · {tagDisplay(tag)}
                  </span>
                );
                return tag.entityType === "LEGISLATOR" ? (
                  <LegislatorProfileTrigger
                    key={`${tag.entityType}-${tag.label}-${i}`}
                    profileId={tag.legislatorProfileId}
                    fullName={tag.label}
                    chamber={item.chamber}
                    className="inline-flex min-h-11 items-center rounded-md px-2 text-[10.5px] font-medium transition-colors hover:bg-[var(--accent-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                    style={{ background: "var(--surface-2)", color: "var(--text)" }}
                  >
                    {content}
                  </LegislatorProfileTrigger>
                ) : (
                  <Link
                    key={`${tag.entityType}-${tag.label}-${i}`}
                    href={entityHref(tag, lang)}
                    className="inline-flex min-h-7 items-center rounded-md px-2 text-[10.5px] font-medium transition-colors hover:bg-[var(--accent-soft)]"
                    style={{ background: "var(--surface-2)", color: "var(--text)" }}
                    title={
                      tag.entityType === "INITIATIVE" && tag.initiativeTitle
                        ? tag.initiativeTitle
                        : es
                          ? "Abrir detalle"
                          : "Open details"
                    }
                  >
                    {content}
                  </Link>
                );
              })}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs font-semibold">
            {detailHref && (
              <Link
                href={detailHref}
                className="inline-flex min-h-9 items-center gap-1.5 hover:underline"
                style={{ color: "var(--accent)" }}
              >
                {es ? "Ver detalle" : "View details"}
                <ArrowRight size={15} aria-hidden />
              </Link>
            )}
            {itemUrl && itemUrl !== detailHref && (
              <a
                href={itemUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-9 items-center gap-1.5 hover:underline"
                style={{ color: "var(--text-muted)" }}
              >
                {es ? "Fuente original" : "Original source"}
                <ArrowSquareOut size={14} aria-hidden />
                <NewTabNotice lang={lang} />
              </a>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

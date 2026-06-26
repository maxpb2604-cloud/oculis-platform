import Link from "next/link";
import { FeedTopicsBar } from "@/components/charts";
import { langQuery, type Lang } from "@/lib/i18n";
import type { Bucket, TrendingEntity, FeedAccount } from "@/lib/data";

const ACCOUNT_KIND: Record<string, { es: string; en: string }> = {
  SENADO_OFFICIAL: { es: "Senado", en: "Senate" },
  INSTITUTION: { es: "Institución", en: "Institution" },
  NEWSPAPER: { es: "Medio", en: "Outlet" },
  JOURNALIST: { es: "Periodista", en: "Journalist" },
  SENATOR: { es: "Senador/a", en: "Senator" },
  DEPUTY: { es: "Diputado/a", en: "Deputy" },
};

function entityHref(e: TrendingEntity, lang: Lang): string {
  const p = new URLSearchParams();
  if (e.entityType === "INITIATIVE") p.set("initiativeCode", e.label);
  else if (e.entityType === "LEGISLATOR" && e.legislatorSourceId)
    p.set("legislatorSourceId", e.legislatorSourceId);
  else if (e.entityType === "COMMISSION") p.set("commissionName", e.label);
  if (lang === "en") p.set("lang", "en");
  return `/feed?${p.toString()}`;
}

/** Right rail: trending topics + trending entities + the accounts-to-follow directory. */
export function FeedRail({
  lang,
  topics,
  entities,
  accounts,
  windowDays,
}: {
  lang: Lang;
  topics: Bucket[];
  entities: TrendingEntity[];
  accounts: FeedAccount[];
  windowDays: number;
}) {
  const es = lang === "es";
  const q = langQuery(lang);
  const windows = [7, 14, 30];

  return (
    <aside className="flex flex-col gap-4">
      <div className="card p-3.5">
        <div className="mb-2 flex items-center justify-between">
          <div className="eyebrow">{es ? "Temas calientes" : "Hot topics"}</div>
          <div className="flex gap-1 text-[10.5px]">
            {windows.map((w) => (
              <Link
                key={w}
                href={`/feed?window=${w}${lang === "en" ? "&lang=en" : ""}`}
                className="rounded px-1.5 py-0.5"
                style={{
                  background: w === windowDays ? "var(--accent-soft)" : "transparent",
                  color: w === windowDays ? "var(--accent)" : "var(--text-muted)",
                  fontWeight: w === windowDays ? 600 : 500,
                }}
              >
                {w}d
              </Link>
            ))}
          </div>
        </div>
        {topics.length > 0 ? (
          <FeedTopicsBar data={topics.slice(0, 7)} lang={lang} />
        ) : (
          <p className="py-3 text-center text-[12px]" style={{ color: "var(--text-muted)" }}>
            {es ? "Sin datos en esta ventana." : "No data in this window."}
          </p>
        )}
      </div>

      {entities.length > 0 && (
        <div className="card p-3.5">
          <div className="eyebrow mb-2">{es ? "En tendencia" : "Trending"}</div>
          <ul className="flex flex-col gap-1.5">
            {entities.map((e, i) => (
              <li key={`${e.entityType}-${e.label}-${i}`}>
                <Link
                  href={entityHref(e, lang)}
                  className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-[12.5px] transition-colors hover:bg-[var(--surface-2)]"
                >
                  <span className="min-w-0 truncate">
                    <span aria-hidden>
                      {e.entityType === "INITIATIVE"
                        ? "🏛 "
                        : e.entityType === "LEGISLATOR"
                          ? "👤 "
                          : "🗂 "}
                    </span>
                    {e.label}
                  </span>
                  <span
                    className="tnum shrink-0 text-[11px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {e.count}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card p-3.5">
        <div className="eyebrow mb-2.5">{es ? "Cuentas a seguir" : "Accounts to follow"}</div>
        <ul className="flex flex-col gap-2">
          {accounts.slice(0, 16).map((a) => {
            const kind = ACCOUNT_KIND[a.kind] ?? { es: a.kind, en: a.kind };
            return (
              <li key={a.id}>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2.5 rounded-lg px-1 py-1 transition-colors hover:bg-[var(--surface-2)]"
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                    style={{ background: "var(--accent)" }}
                    aria-hidden
                  >
                    {a.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 leading-tight">
                    <span className="block truncate text-[12.5px] font-medium">{a.name}</span>
                    <span
                      className="block truncate text-[11px]"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {a.handle} · {es ? kind.es : kind.en}
                    </span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
        <Link
          href={`/feed${q}`}
          className="mt-2 block text-center text-[11.5px]"
          style={{ color: "var(--accent)" }}
        >
          {es ? "Directorio completo →" : "Full directory →"}
        </Link>
      </div>
    </aside>
  );
}

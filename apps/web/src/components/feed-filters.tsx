"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { CATEGORY_LABELS, type Category } from "@oculis/core";
import { type Lang } from "@/lib/i18n";
import { FeedBillSearch } from "@/components/feed-bill-search";

interface Facets {
  categories: string[];
}

/** Left column: kind / topic / chamber / bill-search filters + the active-entity filter chip. */
export function FeedFilters({
  lang,
  facets,
  active,
  activeLabel,
}: {
  lang: Lang;
  facets: Facets;
  active: Record<string, string | undefined>;
  activeLabel?: string;
}) {
  const es = lang === "es";
  const router = useRouter();
  const sp = useSearchParams();

  const navigate = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    // Any filter interaction exits the standalone "directory" view (it's only
    // entered via the rail link). Otherwise view=directory would stick to the URL
    // and the directory would keep showing even after picking Redes / a filter.
    p.delete("view");
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") p.delete(k);
      else p.set(k, v);
    }
    const qs = p.toString();
    router.push(`/feed${qs ? `?${qs}` : ""}`);
  };

  const KINDS = [
    { val: "", es: "Todo", en: "All" },
    { val: "OFFICIAL", es: "Oficial", en: "Official" },
    { val: "NEWS", es: "Prensa", en: "Press" },
    { val: "SOCIAL", es: "Redes", en: "Social" },
    { val: "LEGISLATIVE", es: "Congreso", en: "Congress" },
  ];
  const curKind = sp.get("kind") ?? "";
  const entityFilter = active.initiativeCode ?? active.legislatorSourceId ?? active.commissionName;

  return (
    <aside className="flex flex-col gap-4">
      {entityFilter && (
        <div className="card p-3">
          <div className="eyebrow mb-1.5">{es ? "Filtrando por" : "Filtering by"}</div>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[13px] font-medium" title={activeLabel ?? entityFilter}>
              {activeLabel ?? entityFilter}
            </span>
            <button
              onClick={() =>
                navigate({ initiativeCode: null, legislatorSourceId: null, commissionName: null })
              }
              className="shrink-0 rounded px-1.5 text-sm"
              style={{ color: "var(--text-muted)", cursor: "pointer" }}
              aria-label={es ? "Quitar filtro" : "Clear filter"}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <FeedBillSearch lang={lang} />

      <div className="card p-3">
        <div className="eyebrow mb-2">{es ? "Tipo" : "Type"}</div>
        <div className="flex flex-col gap-1">
          {KINDS.map((kd) => {
            const on = curKind === kd.val;
            return (
              <button
                key={kd.val || "all"}
                onClick={() => navigate({ kind: kd.val || null })}
                className="rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--surface-2)]"
                style={{
                  background: on ? "var(--accent-soft)" : "transparent",
                  color: on ? "var(--accent)" : "var(--text-muted)",
                  fontWeight: on ? 600 : 500,
                  cursor: "pointer",
                }}
              >
                {es ? kd.es : kd.en}
              </button>
            );
          })}
        </div>
      </div>

      <div className="card p-3">
        <div className="eyebrow mb-2">{es ? "Tema" : "Topic"}</div>
        <Select
          value={sp.get("category") ?? ""}
          onChange={(v) => navigate({ category: v || null })}
          all={es ? "Todos" : "All"}
          options={facets.categories.map((c) => ({
            value: c,
            label: CATEGORY_LABELS[c as Category] ?? c,
          }))}
        />
        <div className="eyebrow mb-2 mt-3">{es ? "Cámara" : "Chamber"}</div>
        <Select
          value={sp.get("chamber") ?? ""}
          onChange={(v) => navigate({ chamber: v || null })}
          all={es ? "Ambas" : "Both"}
          options={[
            { value: "SENADO", label: es ? "Senado" : "Senate" },
            { value: "DIPUTADOS", label: es ? "Diputados" : "Deputies" },
          ]}
        />
      </div>
    </aside>
  );
}

function Select({
  value,
  onChange,
  all,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  all: string;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg px-2.5 py-1.5 text-[13px] outline-none"
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        color: "var(--text)",
      }}
    >
      <option value="">{all}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

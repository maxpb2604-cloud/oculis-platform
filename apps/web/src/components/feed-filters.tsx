"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { CaretDown, FunnelSimple, X } from "@phosphor-icons/react";
import { type Lang } from "@/lib/i18n";
import { FeedBillSearch } from "@/components/feed-bill-search";

/** Left column: source kind, chamber, and active-entity filters. */
export function FeedFilters({
  lang,
  active,
  activeLabel,
}: {
  lang: Lang;
  active: Record<string, string | undefined>;
  activeLabel?: string;
}) {
  const es = lang === "es";
  const [mobileOpen, setMobileOpen] = useState(false);
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
    { val: "LEGISLATIVE", es: "Cambios legislativos", en: "Legislative changes" },
    { val: "OFFICIAL", es: "Publicaciones oficiales", en: "Official publications" },
    { val: "NEWS", es: "Prensa y contexto", en: "Press and context" },
    { val: "SOCIAL", es: "Cuentas públicas", en: "Public accounts" },
    { val: "ALL", es: "Todo el contenido", en: "All content" },
  ];
  const curKind = sp.get("kind") ?? "LEGISLATIVE";
  const currentKind = KINDS.find((kind) => kind.val === curKind) ?? KINDS[0]!;
  const entityFilter = active.initiativeCode ?? active.legislatorSourceId ?? active.commissionName;

  return (
    <aside className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={mobileOpen}
        aria-controls="feed-filter-panel"
        onClick={() => setMobileOpen((open) => !open)}
        className="flex min-h-11 items-center justify-between rounded-lg border px-3.5 py-2.5 text-sm font-semibold lg:hidden"
      >
        <span className="flex items-center gap-2">
          <FunnelSimple size={17} aria-hidden />
          {es ? "Filtrar cambios" : "Filter changes"}
        </span>
        <span className="flex items-center gap-1.5" style={{ color: "var(--accent)" }}>
          <span className="max-w-36 truncate text-xs">{es ? currentKind.es : currentKind.en}</span>
          <CaretDown
            size={16}
            style={{
              transition: "transform .15s",
              transform: mobileOpen ? "rotate(180deg)" : "none",
            }}
            aria-hidden
          />
        </span>
      </button>

      <div
        id="feed-filter-panel"
        className={`${mobileOpen ? "flex" : "hidden"} flex-col gap-4 lg:flex`}
      >
        {entityFilter && (
          <div className="rounded-lg border p-3">
            <div className="eyebrow mb-1.5">{es ? "Filtro activo" : "Active filter"}</div>
            <div className="flex items-center justify-between gap-2">
              <span
                className="truncate text-[13px] font-medium"
                title={activeLabel ?? entityFilter}
              >
                {activeLabel ?? entityFilter}
              </span>
              <button
                onClick={() =>
                  navigate({ initiativeCode: null, legislatorSourceId: null, commissionName: null })
                }
                className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded px-2 text-[11px] font-semibold"
                style={{ color: "var(--text-muted)", cursor: "pointer" }}
                aria-label={es ? "Quitar filtro" : "Clear filter"}
              >
                <X size={14} aria-hidden />
                {es ? "Quitar" : "Clear"}
              </button>
            </div>
          </div>
        )}

        <FeedBillSearch
          lang={lang}
          onSelect={(code) =>
            navigate({
              initiativeCode: code,
              legislatorSourceId: null,
              commissionName: null,
              search: null,
            })
          }
        />

        <div className="rounded-lg border p-3">
          <div className="eyebrow mb-2">{es ? "Contenido" : "Content"}</div>
          <div className="flex flex-col gap-1">
            {KINDS.map((kd) => {
              const on = curKind === kd.val;
              return (
                <button
                  key={kd.val}
                  type="button"
                  onClick={() => navigate({ kind: kd.val })}
                  aria-pressed={on}
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

        <div className="rounded-lg border p-3">
          <label htmlFor="feed-chamber" className="eyebrow mb-2 block">
            {es ? "Cámara" : "Chamber"}
          </label>
          <Select
            id="feed-chamber"
            label={es ? "Filtrar por cámara" : "Filter by chamber"}
            value={sp.get("chamber") ?? ""}
            onChange={(v) => navigate({ chamber: v || null })}
            all={es ? "Ambas" : "Both"}
            options={[
              { value: "SENADO", label: es ? "Senado" : "Senate" },
              { value: "DIPUTADOS", label: es ? "Diputados" : "Deputies" },
            ]}
          />
        </div>
      </div>
    </aside>
  );
}

function Select({
  id,
  label,
  value,
  onChange,
  all,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  all: string;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      id={id}
      aria-label={label}
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

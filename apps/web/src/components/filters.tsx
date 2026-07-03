"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CATEGORY_LABELS, type Category } from "@oculis/core";
import { t, type Lang } from "@/lib/i18n";

interface Facets {
  categories: string[];
  parties: string[];
  statuses: string[];
  risks: string[];
}

/** Filter + search bar that drives the browse view via URL params. */
export function Filters({ lang, facets }: { lang: Lang; facets: Facets }) {
  const router = useRouter();
  const sp = useSearchParams();
  const urlSearch = sp.get("search") ?? "";
  const [search, setSearch] = useState(urlSearch);

  // Keep the input in sync with the URL ("Limpiar", back/forward) — otherwise it shows stale text.
  useEffect(() => {
    setSearch(urlSearch);
  }, [urlSearch]);

  function navigate(next: Record<string, string>) {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    params.delete("page"); // reset pagination on filter change
    router.push(`/initiatives?${params.toString()}`);
  }

  const labelFor = (cat: string) => CATEGORY_LABELS[cat as Category] ?? cat;
  const RISK_LABELS: Record<string, { es: string; en: string }> = {
    ALTO: { es: "Alto", en: "High" },
    MEDIO: { es: "Medio", en: "Medium" },
    BAJO: { es: "Bajo", en: "Low" },
  };
  const riskLabel = (r: string) => RISK_LABELS[r]?.[lang] ?? r;
  const CHAMBERS: { value: string; label: string }[] = [
    { value: "SENADO", label: lang === "es" ? "Senado" : "Senate" },
    { value: "DIPUTADOS", label: lang === "es" ? "Diputados" : "Deputies" },
  ];
  const APPROVALS = ["ALTA", "MEDIA", "BAJA"];
  const sel = (k: string) => sp.get(k) ?? "";
  const anyFilter = ["search", "category", "risk", "approval", "party", "status", "chamber"].some((k) => sp.get(k));

  return (
    <div className="card mb-4 flex flex-wrap items-center gap-2 p-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          navigate({ search });
        }}
        className="relative flex-1 min-w-[200px]"
      >
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={lang === "es" ? "Buscar por título o código…" : "Search by title or code…"}
          className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2"
          style={{ borderColor: "var(--border)" }}
        />
      </form>

      <Select label={lang === "es" ? "Cámara" : "Chamber"} value={sel("chamber")} onChange={(v) => navigate({ chamber: v })}
        options={CHAMBERS} allLabel={lang === "es" ? "Todas" : "All"} />
      <Select label={lang === "es" ? "Categoría" : "Category"} value={sel("category")} onChange={(v) => navigate({ category: v })}
        options={facets.categories.map((c) => ({ value: c, label: labelFor(c) }))} allLabel={lang === "es" ? "Todas" : "All"} />
      <Select label={lang === "es" ? "Riesgo" : "Risk"} value={sel("risk")} onChange={(v) => navigate({ risk: v })}
        options={facets.risks.map((r) => ({ value: r, label: riskLabel(r) }))} allLabel={lang === "es" ? "Todos" : "All"} />
      <Select label={lang === "es" ? "Prob. aprobación" : "Approval prob."} value={sel("approval")} onChange={(v) => navigate({ approval: v })}
        options={APPROVALS.map((a) => ({ value: a, label: t(lang, `approval${a}`) }))} allLabel={lang === "es" ? "Todas" : "All"} />
      <Select label={lang === "es" ? "Partido" : "Party"} value={sel("party")} onChange={(v) => navigate({ party: v })}
        options={facets.parties.map((p) => ({ value: p, label: p }))} allLabel={lang === "es" ? "Todos" : "All"} />
      <Select label={lang === "es" ? "Estado" : "Status"} value={sel("status")} onChange={(v) => navigate({ status: v })}
        options={facets.statuses.map((s) => ({ value: s, label: s }))} allLabel={lang === "es" ? "Todos" : "All"} />

      {anyFilter && (
        <button
          onClick={() => router.push(lang === "en" ? "/initiatives?lang=en" : "/initiatives")}
          className="rounded-lg border px-3 py-2 text-xs font-medium transition-colors hover:bg-[var(--surface-2)]"
          style={{ cursor: "pointer", color: "var(--text-muted)" }}
        >
          {lang === "es" ? "Limpiar" : "Clear"}
        </button>
      )}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  allLabel: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border bg-transparent px-2.5 py-2 text-sm outline-none"
      style={{ borderColor: "var(--border)", cursor: "pointer", color: value ? "var(--text)" : "var(--text-muted)" }}
    >
      <option value="">{label}: {allLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value} style={{ color: "var(--text)" }}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

"use client";

import { Buildings, FunnelSimple, MagnifyingGlass, X } from "@phosphor-icons/react";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useEffect, useState } from "react";
import { type Lang } from "@/lib/i18n";
import { partyDisplayLabel } from "@/lib/party-presentation";

interface Facets {
  parties: string[];
  statuses: string[];
  provinces: string[];
}

const CHAMBERS = [
  { value: "", es: "Todas", en: "All" },
  { value: "DIPUTADOS", es: "Diputados", en: "Deputies" },
  { value: "SENADO", es: "Senado", en: "Senate" },
] as const;

export interface LegislatorCatalogFilter {
  profileId: number;
  fullName: string;
  chamber: "DIPUTADOS" | "SENADO";
}

/** Search and evidence-backed filters. Every state is encoded in the URL for sharing. */
export function Filters({
  lang,
  facets,
  legislatorFilter = null,
}: {
  lang: Lang;
  facets: Facets;
  legislatorFilter?: LegislatorCatalogFilter | null;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [search, setSearch] = useState(sp.get("search") ?? "");
  const [showFilters, setShowFilters] = useState(
    Boolean(sp.get("party") || sp.get("status") || sp.get("province")),
  );
  const es = lang === "es";

  useEffect(() => setSearch(sp.get("search") ?? ""), [sp]);

  function navigate(next: Record<string, string>) {
    const params = new URLSearchParams(sp.toString());
    if (legislatorFilter) params.set("chamber", legislatorFilter.chamber);
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    params.delete("page");
    const query = params.toString();
    router.push(`/initiatives${query ? `?${query}` : ""}`);
  }

  const valueFor = (key: string) => sp.get(key) ?? "";
  const selectedParty = valueFor("party");
  const selectedStatus = valueFor("status");
  const selectedChamber = legislatorFilter?.chamber ?? valueFor("chamber");
  const selectedProvince = valueFor("province");
  const selectedLegislator = valueFor("legislator");
  const committedSearch = valueFor("search");
  const anyFilter = Boolean(
    committedSearch ||
    selectedParty ||
    selectedStatus ||
    selectedChamber ||
    selectedProvince ||
    selectedLegislator,
  );
  const provinceOptions = selectedProvince
    ? [selectedProvince, ...facets.provinces.filter((province) => province !== selectedProvince)]
    : facets.provinces;

  const activeFilters = [
    committedSearch
      ? {
          key: "search",
          label: es ? `Búsqueda: ${committedSearch}` : `Search: ${committedSearch}`,
          removable: true,
        }
      : null,
    selectedChamber
      ? {
          key: "chamber",
          label: es
            ? `Cámara: ${selectedChamber === "SENADO" ? "Senado" : "Cámara de Diputados"}`
            : `Chamber: ${selectedChamber === "SENADO" ? "Senate" : "Chamber of Deputies"}`,
          removable: !legislatorFilter,
        }
      : null,
    selectedParty
      ? {
          key: "party",
          label: es
            ? `Partido: ${partyDisplayLabel(selectedParty, null, lang)}`
            : `Party: ${partyDisplayLabel(selectedParty, null, lang)}`,
          removable: true,
        }
      : null,
    selectedStatus
      ? {
          key: "status",
          label: es ? `Estado: ${selectedStatus}` : `Status: ${selectedStatus}`,
          removable: true,
        }
      : null,
    selectedProvince
      ? {
          key: "province",
          label: es ? `Provincia: ${selectedProvince}` : `Province: ${selectedProvince}`,
          removable: true,
        }
      : null,
    selectedLegislator && legislatorFilter
      ? {
          key: "legislator",
          label: es
            ? `Proponente: ${legislatorFilter.fullName}`
            : `Sponsor: ${legislatorFilter.fullName}`,
          removable: true,
        }
      : null,
  ].filter((item): item is { key: string; label: string; removable: boolean } => item != null);

  return (
    <section
      className="card elev mb-5 overflow-hidden"
      aria-label={es ? "Buscar y filtrar" : "Search and filter"}
    >
      <div className="p-4 sm:p-5">
        {selectedLegislator && legislatorFilter && (
          <div
            className="mb-4 rounded-lg border px-3.5 py-3 text-xs leading-relaxed"
            style={{ borderColor: "var(--border)", background: "var(--accent-soft)" }}
          >
            <strong className="block text-[13px]" style={{ color: "var(--text)" }}>
              {es
                ? `Iniciativas vinculadas a ${legislatorFilter.fullName}`
                : `Initiatives linked to ${legislatorFilter.fullName}`}
            </strong>
            <span className="mt-1 block" style={{ color: "var(--text-muted)" }}>
              {es
                ? `Incluye iniciativas en las que ${legislatorFilter.fullName} figura como proponente principal, coproponente o proponente publicado, según la evidencia oficial disponible.`
                : `Includes initiatives where ${legislatorFilter.fullName} appears as a principal sponsor, co-sponsor, or published sponsor in the available official evidence.`}
            </span>
          </div>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            navigate({ search: search.trim() });
          }}
          className="flex min-w-0 gap-2"
          role="search"
        >
          <label htmlFor="initiative-search" className="sr-only">
            {es ? "Buscar iniciativas por título o código" : "Search initiatives by title or code"}
          </label>
          <div className="relative min-w-0 flex-1">
            <MagnifyingGlass
              aria-hidden
              size={19}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2"
              style={{ color: "var(--text-muted)" }}
            />
            <input
              id="initiative-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={
                es ? "Busca por título, código o tema" : "Search by title, code or subject"
              }
              className="min-h-11 w-full min-w-0 rounded-lg border bg-transparent py-2.5 pl-11 pr-3 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
              style={{ borderColor: "var(--border-strong)" }}
            />
          </div>
          <button
            type="submit"
            aria-label={es ? "Buscar iniciativas" : "Search initiatives"}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            <MagnifyingGlass aria-hidden size={17} weight="bold" />
            <span className="hidden sm:inline">{es ? "Buscar" : "Search"}</span>
          </button>
        </form>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <fieldset className="w-full sm:w-auto">
            <legend
              className="mb-2 flex items-center gap-2 text-xs font-semibold"
              style={{ color: "var(--text-muted)" }}
            >
              <Buildings aria-hidden size={16} />
              {es ? "Cámara" : "Chamber"}
            </legend>
            <div
              className="grid grid-cols-3 rounded-lg border p-1 sm:inline-grid sm:min-w-[390px]"
              style={{ borderColor: "var(--border)" }}
            >
              {CHAMBERS.map((chamber) => {
                const active = selectedChamber === chamber.value;
                const lockedByProfile = Boolean(
                  legislatorFilter && chamber.value !== legislatorFilter.chamber,
                );
                return (
                  <button
                    key={chamber.value || "all"}
                    type="button"
                    aria-pressed={active}
                    disabled={lockedByProfile}
                    onClick={() => navigate({ chamber: chamber.value })}
                    className="min-h-9 rounded-md px-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-35 sm:text-sm"
                    style={{
                      color: active ? "var(--accent)" : "var(--text-muted)",
                      background: active ? "var(--accent-soft)" : "transparent",
                    }}
                  >
                    {chamber[lang]}
                  </button>
                );
              })}
            </div>
            {legislatorFilter && (
              <p className="mt-1.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                {es
                  ? "La cámara corresponde al perfil seleccionado."
                  : "The chamber is fixed by the selected profile."}
              </p>
            )}
          </fieldset>

          <button
            type="button"
            aria-expanded={showFilters}
            aria-controls="initiative-secondary-filters"
            onClick={() => setShowFilters((visible) => !visible)}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors hover:bg-[var(--surface-2)]"
            style={{ color: "var(--text-muted)" }}
          >
            <FunnelSimple aria-hidden size={16} weight="bold" />
            {es ? "Más filtros" : "More filters"}
            {(selectedParty || selectedStatus || selectedProvince) && (
              <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] text-[var(--accent)]">
                {[selectedParty, selectedStatus, selectedProvince].filter(Boolean).length}
              </span>
            )}
          </button>
        </div>

        <div
          id="initiative-secondary-filters"
          hidden={!showFilters}
          className="mt-3 grid grid-cols-1 gap-2 border-t pt-3 sm:grid-cols-3"
        >
          <Select
            id="initiative-province"
            label={es ? "Provincia del proponente" : "Sponsor province"}
            value={selectedProvince}
            onChange={(value) => navigate({ province: value })}
            options={provinceOptions.map((province) => ({ value: province, label: province }))}
            allLabel={es ? "Todas las provincias" : "All provinces"}
          />
          <Select
            id="initiative-party"
            label={es ? "Partido" : "Party"}
            value={selectedParty}
            onChange={(value) => navigate({ party: value })}
            options={facets.parties.map((party) => ({
              value: party,
              label: partyDisplayLabel(party, null, lang) ?? party,
            }))}
            allLabel={es ? "Todos los partidos" : "All parties"}
          />
          <Select
            id="initiative-status"
            label={es ? "Estado oficial" : "Official status"}
            value={selectedStatus}
            onChange={(value) => navigate({ status: value })}
            options={facets.statuses.map((status) => ({ value: status, label: status }))}
            allLabel={es ? "Todos los estados" : "All statuses"}
          />
        </div>

        {(activeFilters.length > 0 || anyFilter) && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3">
            {activeFilters.map((filter) =>
              filter.removable ? (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => navigate({ [filter.key]: "" })}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-xs font-medium hover:bg-[var(--surface-2)]"
                  aria-label={es ? `Quitar ${filter.label}` : `Remove ${filter.label}`}
                >
                  <span className="max-w-[240px] truncate">{filter.label}</span>
                  <X aria-hidden size={12} weight="bold" />
                </button>
              ) : (
                <span
                  key={filter.key}
                  className="inline-flex min-h-10 items-center rounded-full border px-3 text-xs font-medium"
                  aria-label={
                    es
                      ? `${filter.label}; fijada por el perfil seleccionado`
                      : `${filter.label}; fixed by the selected profile`
                  }
                >
                  {filter.label}
                </span>
              ),
            )}
            {anyFilter && (
              <button
                type="button"
                onClick={() => router.push(lang === "en" ? "/initiatives?lang=en" : "/initiatives")}
                className="min-h-8 px-2 text-xs font-semibold underline-offset-4 hover:underline"
                style={{ color: "var(--accent)" }}
              >
                {es ? "Limpiar todo" : "Clear all"}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Select({
  id,
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  allLabel: string;
}) {
  return (
    <label
      htmlFor={id}
      className="grid gap-1.5 text-xs font-semibold"
      style={{ color: "var(--text-muted)" }}
    >
      {label}
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 w-full min-w-0 rounded-lg border bg-[var(--surface)] px-3 text-sm font-normal outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
        style={{ borderColor: "var(--border-strong)", color: "var(--text)" }}
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

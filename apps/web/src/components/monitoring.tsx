/**
 * Phase 1 monitoring UI — shared building blocks for the daily activity dashboard.
 * Pure presentational server components; data comes from lib/data.ts.
 */
import { STAGE_META, normalizeStatus } from "@oculis/core";

export interface ActivityItem {
  id: number;
  scope: string;
  chamber: string | null;
  eventDate: string | null;
  kind: string | null;
  body: string | null;
  description: string;
  agendaUrl: string | null;
  statuses: string[] | null;
  initiativeCount: number;
}

const SCOPE_LABEL: Record<string, string> = {
  PLENARY: "Pleno",
  ASAMBLEA: "Asamblea",
  COMMITTEE: "Comisión",
};

const STAGE_COLOR: Record<string, string> = {
  slate: "#64748b", blue: "#3b82f6", violet: "#8b5cf6", amber: "#d97706",
  green: "#0b6e4f", teal: "#0d9488", rose: "#e11d48",
};

/** Small KPI tile (count + label). */
export function StatTile({ value, label, accent = "var(--accent)" }: { value: number | string; label: string; accent?: string }) {
  return (
    <div className="card elev p-4">
      <div className="tnum text-[28px] font-semibold leading-none">{value}</div>
      <div className="eyebrow mt-2">{label}</div>
      <div className="mt-2 h-[3px] w-8 rounded-full" style={{ background: accent }} />
    </div>
  );
}

/** Scope chip (Pleno / Asamblea / Comisión). Label is always text, not color-only. */
export function ScopeChip({ scope }: { scope: string }) {
  return (
    <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
      {SCOPE_LABEL[scope] ?? scope}
    </span>
  );
}

/** Status chip with self-explanatory tooltip. The label text always carries the
 *  meaning (never color-only); the dot is decorative (aria-hidden). */
export function StatusChip({ raw }: { raw: string }) {
  const meta = normalizeStatus(raw);
  const color = STAGE_COLOR[STAGE_META[meta.stage].color] ?? "#64748b";
  return (
    <span title={meta.tooltip} aria-label={`${meta.label}: ${meta.tooltip}`}
      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium"
      style={{ background: `${color}1a`, color }}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {meta.label}
    </span>
  );
}

/** One agenda/activity row. Composes structured fields — body (title), status chips,
 *  count chip, date — instead of re-printing a pre-baked description string. */
export function ActivityRow({ item }: { item: ActivityItem }) {
  const statuses = item.statuses ?? [];
  // show description only when it adds detail beyond the body title
  const showDesc = item.description && item.description.trim() !== (item.body ?? "").trim();
  return (
    <div className="flex items-start gap-3 border-b px-5 py-3 last:border-0">
      <div className="pt-0.5"><ScopeChip scope={item.scope} /></div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-snug">{item.body}</div>
        {showDesc && (
          <div className="mt-0.5 text-[13px]" style={{ color: "var(--text-muted)" }}>{item.description}</div>
        )}
        {statuses.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {statuses.map((s, i) => <StatusChip key={i} raw={s} />)}
          </div>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
          {item.kind && <span>{item.kind}</span>}
          {item.initiativeCount > 0 && (
            <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-medium">
              {item.initiativeCount} {item.initiativeCount === 1 ? "iniciativa" : "iniciativas"}
            </span>
          )}
          {item.agendaUrl && (
            <a href={item.agendaUrl} target="_blank" rel="noreferrer"
              className="font-medium underline-offset-2 hover:underline" style={{ color: "var(--accent)" }}>
              Ver documento ↗
            </a>
          )}
        </div>
      </div>
      {item.eventDate && (
        <div className="tnum shrink-0 text-[11px]" style={{ color: "var(--text-muted)" }}>
          {item.eventDate.slice(8, 10)}/{item.eventDate.slice(5, 7)}
        </div>
      )}
    </div>
  );
}

/** A list of activity with empty state. */
export function ActivityList({ items, empty }: { items: ActivityItem[]; empty: React.ReactNode }) {
  if (!items.length) {
    return <div className="px-5 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>{empty}</div>;
  }
  return <div>{items.map((i) => <ActivityRow key={i.id} item={i} />)}</div>;
}

/** Legend explaining the lifecycle stages (makes the dashboard self-explanatory). */
export function StatusLegend() {
  const stages = Object.entries(STAGE_META).sort((a, b) => a[1].order - b[1].order);
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {stages.map(([key, m]) => {
        const color = STAGE_COLOR[m.color] ?? "#64748b";
        return (
          <span key={key} className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: "var(--text-muted)" }}>
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: color }} />
            {m.label}
          </span>
        );
      })}
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
function DocStatus({ uploaded, senado }: { uploaded: boolean; senado?: boolean }) {
  // The Senate's document registry is behind a login, so document availability can't be
  // verified publicly per-initiative — we flag it as "consult the portal" rather than
  // claiming pending/uploaded.
  const m = senado
    ? { bg: "var(--surface-2)", fg: "var(--text-muted)", label: "Documento: consultar en el portal del Senado" }
    : uploaded
      ? { bg: "var(--accent-soft)", fg: "var(--accent)", label: "Documento depositado" }
      : { bg: "var(--warn-soft)", fg: "var(--warn)", label: "Documento pendiente" };
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: m.bg, color: m.fg }}>
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
export function DepositCard({ item }: { item: DepositItem }) {
  const sponsorMeta = [item.party, item.province].filter(Boolean).join(" · ");
  const others = (item.sponsorCount ?? 1) - 1;
  const isSenado = item.chamber === "SENADO";
  return (
    <div data-initiative-id={item.id} className="flex cursor-pointer flex-col gap-2 border-b px-5 py-4 last:border-0 transition-colors hover:bg-[var(--surface-2)]">
      <div className="flex items-center gap-2">
        {item.code && (
          <span className="tnum rounded px-1.5 py-0.5 text-[11px] font-semibold"
            style={{ background: "var(--surface-2)" }}>{item.code}</span>
        )}
        {item.type && <span className="eyebrow">{item.type}</span>}
        {item.filedAt && (
          <span className="tnum ml-auto text-[11px]" style={{ color: "var(--text-muted)" }}>
            {item.filedAt.slice(8, 10)}/{item.filedAt.slice(5, 7)}/{item.filedAt.slice(0, 4)}
          </span>
        )}
      </div>

      <div className="text-sm font-medium leading-snug">{item.title}</div>

      {item.sponsor && (
        <div className="flex flex-wrap items-center gap-x-1.5 text-[12px]" style={{ color: "var(--text-muted)" }}>
          <span>Depositada por</span>
          <span className="font-semibold" style={{ color: "var(--text)" }}>{item.sponsor}</span>
          {item.sponsorRole && <span>· {item.sponsorRole}</span>}
          {sponsorMeta && <span>· {sponsorMeta}</span>}
          {others > 0 && (
            <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-medium">
              +{others} proponente{others === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <DocStatus uploaded={item.docUploaded} senado={isSenado} />
        {isSenado && item.sourceId ? (
          <a href={`/api/senado/ficha/${item.sourceId}`} target="_blank" rel="noreferrer"
            className="text-[11px] font-medium underline-offset-2 hover:underline" style={{ color: "var(--accent)" }}>
            Abrir expediente en el Senado ↗
          </a>
        ) : item.sourceUrl ? (
          <a href={item.sourceUrl} target="_blank" rel="noreferrer"
            className="text-[11px] font-medium underline-offset-2 hover:underline" style={{ color: "var(--accent)" }}>
            Ver ficha en SIL ↗
          </a>
        ) : null}
        {!isSenado && item.docUploaded && item.docUrl && (
          <a href={item.docUrl} target="_blank" rel="noreferrer"
            className="text-[11px] font-medium underline-offset-2 hover:underline" style={{ color: "var(--accent)" }}>
            Abrir documento ↗
          </a>
        )}
      </div>
    </div>
  );
}

export function DepositList({ items, empty }: { items: DepositItem[]; empty: React.ReactNode }) {
  if (!items.length) return <div className="px-5 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>{empty}</div>;
  return <div>{items.map((i) => <DepositCard key={i.id} item={i} />)}</div>;
}

// --- Regulatory monitoring building blocks ---

export interface RegulationItem {
  id: number;
  institution: string;
  regType: string | null;
  title: string;
  status: string | null;
  interventionLevel: string | null;
  category: string | null;
  isConsulta: boolean;
  publishedAt: string | null;
  deadline: string | null;
  url: string | null;
}

const INTERV = {
  HIGH: { label: "Alta posibilidad de intervención", short: "Intervención ALTA", color: "#0b6e4f" },
  INTERMEDIATE: { label: "Posibilidad intermedia", short: "Intervención MEDIA", color: "#d97706" },
  LOW: { label: "Baja posibilidad (ya publicado)", short: "Intervención BAJA", color: "#64748b" },
} as const;

/** Possibility-of-intervention chip — the key regulatory signal (HIGH = act now). */
export function InterventionChip({ level }: { level: string | null }) {
  const m = INTERV[(level as keyof typeof INTERV)] ?? INTERV.LOW;
  return (
    <span title={m.label} aria-label={m.label}
      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: `${m.color}1a`, color: m.color }}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: m.color }} />
      {m.short}
    </span>
  );
}

export function RegulationRow({ item }: { item: RegulationItem }) {
  return (
    <div className="flex items-start gap-3 border-b px-5 py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{item.institution}</span>
          {item.regType && <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{item.regType}</span>}
          {item.isConsulta && (
            <span className="rounded px-1.5 py-0.5 text-[10px] font-bold"
              style={{ background: "var(--accent)", color: "#fff" }}>CONSULTA PÚBLICA</span>
          )}
        </div>
        <div className="mt-1 text-sm font-medium leading-snug">{item.title}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
          {item.status && <span>{item.status}</span>}
          {item.deadline && <span className="font-medium" style={{ color: "var(--warn)" }}>Plazo: {item.deadline}</span>}
          {item.url && (
            <a href={item.url} target="_blank" rel="noreferrer"
              className="font-medium underline-offset-2 hover:underline" style={{ color: "var(--accent)" }}>
              Ver documento ↗
            </a>
          )}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <InterventionChip level={item.interventionLevel} />
        {item.publishedAt && <div className="tnum mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>{item.publishedAt}</div>}
      </div>
    </div>
  );
}

export function RegulationList({ items, empty }: { items: RegulationItem[]; empty: React.ReactNode }) {
  if (!items.length) return <div className="px-5 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>{empty}</div>;
  return <div>{items.map((i) => <RegulationRow key={i.id} item={i} />)}</div>;
}

// --- Health (Estado de monitoreo) building blocks ---

/** OK / WARN / ERROR pill using design tokens (dark-mode safe). */
export function HealthPill({ state, children }: { state: "ok" | "warn" | "error"; children: React.ReactNode }) {
  const map = {
    ok: { bg: "var(--accent-soft)", fg: "var(--accent)" },
    warn: { bg: "var(--warn-soft)", fg: "var(--warn)" },
    error: { bg: "var(--danger-soft)", fg: "var(--danger)" },
  }[state];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: map.bg, color: map.fg }}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: map.fg }} />
      {children}
    </span>
  );
}

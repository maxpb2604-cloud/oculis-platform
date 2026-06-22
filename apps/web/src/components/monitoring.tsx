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

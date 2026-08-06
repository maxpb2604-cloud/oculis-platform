/** Small, dependency-free report primitives shared across server and client views. */
export function Kpi({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="card elev p-5">
      <div className="eyebrow">{label}</div>
      <div className="tnum mt-2 text-[34px] font-semibold leading-none">
        {value.toLocaleString()}
      </div>
      <div className="mt-3 h-[3px] w-9 rounded-full" style={{ background: accent }} />
    </div>
  );
}

export function SectionHeading({ n, title }: { n: string; title: string }) {
  return (
    <div className="mb-3 mt-8 flex items-baseline gap-3">
      {n && (
        <span className="tnum text-xs font-semibold" style={{ color: "var(--accent)" }}>
          {n}
        </span>
      )}
      <h2 className="serif text-lg font-semibold">{title}</h2>
      <span className="hairline flex-1 self-center" />
    </div>
  );
}

export function Panel({
  title,
  children,
  flush,
  action,
}: {
  title: string;
  children: React.ReactNode;
  flush?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b px-5 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      <div className={flush ? "" : "p-5"}>{children}</div>
    </div>
  );
}

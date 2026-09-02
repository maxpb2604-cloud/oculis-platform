/** Canonical editorial-data primitives shared across server and client views. */
export function Kpi({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="min-w-0 border-l-2 py-1 pl-4" style={{ borderColor: accent }}>
      <div className="eyebrow">{label}</div>
      <div className="tnum mt-2 text-2xl font-semibold leading-none sm:text-[32px]">
        {value.toLocaleString()}
      </div>
    </div>
  );
}

export function SectionHeading({
  n,
  title,
  description,
  action,
}: {
  n?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 mt-10 flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-baseline gap-3">
          {n && <span className="tnum text-xs font-semibold text-[var(--accent)]">{n}</span>}
          <h2 className="section-title">{title}</h2>
        </div>
        {description && <p className="mt-1.5 text-sm text-[var(--text-muted)]">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Panel({
  title,
  children,
  flush,
  action,
  headingLevel = 2,
}: {
  title: string;
  children: React.ReactNode;
  flush?: boolean;
  action?: React.ReactNode;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <section className="card overflow-hidden">
      <div className="flex min-h-14 items-center justify-between gap-4 border-b px-4 py-3 sm:px-5">
        <Heading className="serif text-lg font-semibold leading-snug">{title}</Heading>
        {action}
      </div>
      <div className={flush ? "" : "p-4 sm:p-5"}>{children}</div>
    </section>
  );
}

export function EditorialIntro({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <section className="mb-8 border-b pb-7 sm:mb-10 sm:pb-9">
      {eyebrow && <div className="eyebrow text-[var(--accent)]">{eyebrow}</div>}
      <div className="mt-2 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h2 className="page-title max-w-[22ch]">{title}</h2>
          {description && <p className="page-subtitle mt-3">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </section>
  );
}

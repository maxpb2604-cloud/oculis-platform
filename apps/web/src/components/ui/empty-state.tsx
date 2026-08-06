import type { Lang } from "@/lib/i18n";

export function EmptyState({
  lang,
  title,
  description,
  action,
  className = "",
}: {
  lang: Lang;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`card border-dashed px-5 py-10 text-center sm:px-10 sm:py-12 ${className}`}
      role="status"
      aria-live="polite"
    >
      <div className="eyebrow">{lang === "es" ? "Estado de los datos" : "Data status"}</div>
      <h2 className="serif mx-auto mt-2 max-w-xl text-xl font-semibold leading-tight">{title}</h2>
      <p
        className="mx-auto mt-2 max-w-2xl text-[13px] leading-relaxed sm:text-sm"
        style={{ color: "var(--text-muted)" }}
      >
        {description}
      </p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </section>
  );
}

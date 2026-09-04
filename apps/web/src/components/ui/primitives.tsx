import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import type { Lang } from "@/lib/i18n";

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function ButtonLink({
  href,
  children,
  variant = "secondary",
  className,
  external,
  ariaLabel,
  lang = "es",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "quiet";
  className?: string;
  external?: boolean;
  ariaLabel?: string;
  lang?: Lang;
}) {
  const props = external ? { target: "_blank" as const, rel: "noopener noreferrer" } : undefined;
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={classes(
        "ui-button",
        variant === "primary" && "ui-button-primary",
        variant === "quiet" && "ui-button-quiet",
        className,
      )}
      {...props}
    >
      {children}
      {external && <NewTabNotice lang={lang} />}
    </Link>
  );
}

export function Button({
  children,
  variant = "secondary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet";
}) {
  return (
    <button
      type={props.type ?? "button"}
      className={classes(
        "ui-button",
        variant === "primary" && "ui-button-primary",
        variant === "quiet" && "ui-button-quiet",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function StatusPill({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "verified" | "warning" | "danger";
  className?: string;
}) {
  return (
    <span className={classes("status-pill", className)} data-tone={tone}>
      {children}
    </span>
  );
}

export function Notice({
  children,
  tone = "info",
  className,
}: {
  children: ReactNode;
  tone?: "info" | "verified" | "warning";
  className?: string;
}) {
  return (
    <div className={classes("notice", className)} data-tone={tone}>
      {children}
    </div>
  );
}

export function SelectField({
  label,
  id,
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  id: string;
  children: ReactNode;
}) {
  return (
    <label htmlFor={id} className={classes("block min-w-0", className)}>
      <span className="eyebrow mb-1.5 block">{label}</span>
      <select id={id} className="ui-select" {...props}>
        {children}
      </select>
    </label>
  );
}

export function Definition({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 py-2.5">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 text-sm leading-relaxed text-[var(--text)]">{children}</dd>
    </div>
  );
}

/** Announces the navigation behavior without adding visual noise to external links. */
export function NewTabNotice({ lang }: { lang: Lang }) {
  return (
    <span className="sr-only">
      {lang === "es" ? " (abre en una pestaña nueva)" : " (opens in a new tab)"}
    </span>
  );
}

import { AppShellFrame } from "@/components/app-shell-frame";
import type { Lang } from "@/lib/i18n";

/** Page chrome shared by every route: module rail + top bar + content area. */
export function AppShell({
  lang,
  title,
  subtitle,
  titleIsHeading = true,
  children,
}: {
  lang: Lang;
  title: string;
  subtitle: string;
  titleIsHeading?: boolean;
  children: React.ReactNode;
}) {
  const dateLabel = new Intl.DateTimeFormat(lang === "es" ? "es-DO" : "en-US", {
    timeZone: "America/Santo_Domingo",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })
    .format(new Date())
    .toUpperCase();

  return (
    <AppShellFrame
      lang={lang}
      dateLabel={dateLabel}
      title={title}
      subtitle={subtitle}
      titleIsHeading={titleIsHeading}
    >
      {children}
    </AppShellFrame>
  );
}

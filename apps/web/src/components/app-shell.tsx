import { AppShellFrame } from "@/components/app-shell-frame";
import { getAdminSession } from "@/lib/admin-auth";
import type { Lang } from "@/lib/i18n";

/** Page chrome shared by every route: module rail + top bar + content area. */
export async function AppShell({
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
  const adminSession = await getAdminSession();
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
      adminSession={
        adminSession ? { displayName: adminSession.displayName, email: adminSession.email } : null
      }
    >
      {children}
    </AppShellFrame>
  );
}

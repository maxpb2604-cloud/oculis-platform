import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminClientManager } from "@/components/admin-client-manager";
import { AppShell } from "@/components/app-shell";
import { getAdminSession } from "@/lib/admin-auth";
import { getAdminClientSummaries } from "@/lib/data";
import { parseLang } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Panel administrativo",
  robots: { index: false, follow: false },
};

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const lang = parseLang((await searchParams).lang);
  const session = await getAdminSession();
  if (!session) redirect(`/admin/login${lang === "en" ? "?lang=en" : ""}`);
  const clients = await getAdminClientSummaries();
  const es = lang === "es";

  return (
    <AppShell
      lang={lang}
      title={es ? "Panel administrativo" : "Administrative panel"}
      subtitle={
        es
          ? "Control privado de clientes, usuarios autorizados e iniciativas asignadas por el equipo FHC."
          : "Private management of clients, authorized users, and initiatives assigned by the FHC team."
      }
    >
      <AdminClientManager clients={clients} adminName={session.displayName} lang={lang} />
    </AppShell>
  );
}

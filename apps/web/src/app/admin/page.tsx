import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminClientManager } from "@/components/admin-client-manager";
import { AppShell } from "@/components/app-shell";
import { getAdminSession } from "@/lib/admin-auth";
import { getAdminClientSummaries, getAdminPortalUsers } from "@/lib/data";
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
  const [adminUsers, clients] = await Promise.all([
    getAdminPortalUsers(),
    getAdminClientSummaries(),
  ]);
  const es = lang === "es";

  return (
    <AppShell
      lang={lang}
      title={es ? "Panel administrativo" : "Administrative panel"}
      subtitle={
        es
          ? "Gestione por separado los accesos del equipo FHC, las cuentas de clientes y las iniciativas asignadas."
          : "Manage FHC team access, client accounts, and assigned initiatives separately."
      }
    >
      <AdminClientManager
        adminUsers={adminUsers}
        clients={clients}
        adminName={session.displayName}
        adminEmail={session.email}
        lang={lang}
      />
    </AppShell>
  );
}

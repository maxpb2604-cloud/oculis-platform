import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Briefcase, ShieldCheck } from "@/components/ui/icons";
import { getAdminSession } from "@/lib/admin-auth";
import { parseLang } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Acceso administrativo",
  robots: { index: false, follow: false },
};

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string; error?: string }>;
}) {
  const params = await searchParams;
  const lang = parseLang(params.lang);
  const es = lang === "es";
  if (await getAdminSession()) redirect(`/admin${lang === "en" ? "?lang=en" : ""}`);

  return (
    <AppShell
      lang={lang}
      title={es ? "Acceso administrativo" : "Administrative access"}
      subtitle={
        es
          ? "Espacio privado para el equipo de Ferdinand Herrera Consultores."
          : "Private workspace for the Ferdinand Herrera Consultants team."
      }
    >
      <section className="mx-auto max-w-lg rounded-[var(--radius-lg)] border bg-[var(--surface)] p-5 shadow-sm sm:p-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-soft)] text-[var(--accent)]">
          <Briefcase size={24} weight="fill" aria-hidden="true" />
        </div>
        <h2 className="mt-5 text-2xl font-semibold">
          {es ? "Panel del equipo FHC" : "FHC team panel"}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
          {es
            ? "Inicia sesión con una cuenta administrativa autorizada. Las asignaciones y notas internas nunca aparecen en el portal público."
            : "Sign in with an authorized administrative account. Assignments and internal notes never appear in the public portal."}
        </p>

        {params.error === "1" ? (
          <div
            role="alert"
            className="mt-5 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]"
          >
            {es
              ? "El correo o la contraseña no son correctos."
              : "The email or password is incorrect."}
          </div>
        ) : null}

        <form action="/api/admin/session" method="post" className="mt-6 space-y-4">
          <input type="hidden" name="lang" value={lang} />
          <div>
            <label htmlFor="admin-email" className="mb-2 block text-sm font-semibold">
              {es ? "Correo del administrador" : "Administrator email"}
            </label>
            <input
              id="admin-email"
              name="email"
              type="email"
              required
              autoComplete="username"
              maxLength={254}
              className="ui-input w-full"
              placeholder="nombre@fhc.do"
            />
          </div>
          <div>
            <label htmlFor="admin-password" className="mb-2 block text-sm font-semibold">
              {es ? "Contraseña" : "Password"}
            </label>
            <input
              id="admin-password"
              name="password"
              type="password"
              required
              minLength={12}
              maxLength={256}
              autoComplete="current-password"
              className="ui-input w-full"
            />
          </div>
          <button
            type="submit"
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-5 text-sm font-semibold text-white hover:opacity-90"
          >
            <ShieldCheck size={18} aria-hidden="true" />
            {es ? "Entrar al panel" : "Open admin panel"}
          </button>
        </form>
      </section>
    </AppShell>
  );
}

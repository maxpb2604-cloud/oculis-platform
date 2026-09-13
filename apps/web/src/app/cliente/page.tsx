import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ArrowRight, ShieldCheck } from "@/components/ui/icons";
import { getClientSession } from "@/lib/client-auth";
import { getClientAssignedInitiatives } from "@/lib/data";
import { parseLang } from "@/lib/i18n";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Mi espacio",
  robots: { index: false, follow: false },
};

export default async function ClientPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const lang = parseLang((await searchParams).lang);
  const es = lang === "es";
  const q = es ? "" : "?lang=en";
  const session = await getClientSession();
  if (!session) redirect(`/login${q}`);
  const assignments = await getClientAssignedInitiatives(session.client.id);

  return (
    <AppShell
      lang={lang}
      title={es ? `Espacio de ${session.client.name}` : `${session.client.name}'s space`}
      subtitle={
        es
          ? "Iniciativas que el equipo FHC ha asignado a su organización."
          : "Initiatives the FHC team has assigned to your organization."
      }
    >
      <div className="mx-auto max-w-6xl space-y-7">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-7">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--accent)]">
              {es ? "CARTERA DE SEGUIMIENTO" : "MONITORING PORTFOLIO"}
            </p>
            <h2 className="mt-2 text-2xl font-bold">{session.client.name}</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {es ? `Bienvenido, ${session.displayName}.` : `Welcome, ${session.displayName}.`}
            </p>
          </div>
          <form action="/api/portal/session" method="post">
            <input type="hidden" name="intent" value="logout" />
            <input type="hidden" name="lang" value={lang} />
            <button
              type="submit"
              className="rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold hover:bg-[var(--accent-soft)]"
            >
              {es ? "Cerrar sesión" : "Sign out"}
            </button>
          </form>
        </div>
        <section aria-labelledby="client-assigned-title">
          <div className="mb-5 flex items-center gap-3">
            <ShieldCheck size={25} className="text-[var(--accent)]" aria-hidden="true" />
            <h2 id="client-assigned-title" className="text-2xl font-bold">
              {es ? "Iniciativas de su interés" : "Initiatives relevant to you"}
            </h2>
            <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-sm font-bold text-[var(--accent)]">
              {assignments.length}
            </span>
          </div>
          {assignments.length ? (
            <div className="grid gap-4 md:grid-cols-2">
              {assignments.map((item) => (
                <article
                  key={item.id}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm transition-shadow hover:shadow-md sm:p-6"
                >
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">
                    <span>
                      {item.kind === "LEGISLATIVE"
                        ? es
                          ? "Legislativa"
                          : "Legislative"
                        : es
                          ? "Regulatoria"
                          : "Regulatory"}
                    </span>
                    {item.code && <span>· {item.code}</span>}
                    {item.institution && <span>· {item.institution}</span>}
                  </div>
                  <h3 className="text-lg font-semibold leading-snug">{item.title}</h3>
                  <Link
                    href={
                      item.kind === "LEGISLATIVE"
                        ? `/initiatives/${item.recordId}${q}`
                        : `/regulatorio?institution=${encodeURIComponent(item.institution || "")}${es ? "" : "&lang=en"}#regulation-${item.recordId}`
                    }
                    className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[var(--accent)] hover:underline"
                  >
                    {es ? "Ver iniciativa y fuente" : "View initiative and source"}
                    <ArrowRight size={17} aria-hidden="true" />
                  </Link>
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-[var(--text-muted)]">
              {es
                ? "Todavía no hay iniciativas asignadas a su organización. El equipo FHC las mostrará aquí cuando corresponda."
                : "There are no initiatives assigned to your organization yet. The FHC team will show them here when relevant."}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

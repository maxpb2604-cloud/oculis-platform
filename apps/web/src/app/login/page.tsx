import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, ShieldCheck } from "@/components/ui/icons";
import { getAdminSession } from "@/lib/admin-auth";
import { getClientSession } from "@/lib/client-auth";
import { parseLang } from "@/lib/i18n";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Iniciar sesión",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string; error?: string }>;
}) {
  const params = await searchParams;
  const lang = parseLang(params.lang);
  const es = lang === "es";
  const q = es ? "" : "?lang=en";
  if (await getAdminSession()) redirect(`/admin${q}`);
  if (await getClientSession()) redirect(`/cliente${q}`);

  return (
    <main className="portal-login">
      <div className="portal-login-photo">
        <Image
          src="/congreso-nacional.jpg"
          alt=""
          fill
          priority
          sizes="(max-width: 800px) 100vw, 55vw"
        />
      </div>
      <div className="portal-login-shade" aria-hidden="true" />
      <div className="portal-login-shell">
        <Link
          href={`/${q}`}
          className="landing-brand portal-login-brand"
          aria-label="Oculis Auribus"
        >
          <span className="landing-brand-symbol">
            <Image src="/oculis-mark.png" alt="" width={1119} height={474} />
          </span>
          <span className="landing-brand-name">
            OCULIS <span>AURIBUS</span>
          </span>
        </Link>
        <div className="portal-login-layout">
          <div className="portal-login-intro">
            <p className="landing-eyebrow landing-eyebrow-light">
              <span className="landing-eyebrow-line" aria-hidden="true" />
              {es ? "SU ESPACIO EN OCULIS" : "YOUR OCULIS SPACE"}
            </p>
            <h1>
              {es ? (
                <>
                  Una visión clara, <em>hecha para usted.</em>
                </>
              ) : (
                <>
                  A clearer view, <em>made for you.</em>
                </>
              )}
            </h1>
            <p>
              {es
                ? "Acceda a su espacio de seguimiento legislativo y regulatorio. El equipo FHC y cada cliente ingresan con su propia cuenta."
                : "Access your legislative and regulatory monitoring space. The FHC team and each client sign in with their own account."}
            </p>
          </div>
          <section className="portal-login-card" aria-labelledby="login-title">
            <div className="portal-login-card-icon">
              <ShieldCheck size={25} weight="duotone" aria-hidden="true" />
            </div>
            <p className="landing-eyebrow">{es ? "ACCESO SEGURO" : "SECURE ACCESS"}</p>
            <h2 id="login-title">{es ? "Iniciar sesión" : "Sign in"}</h2>
            <p className="portal-login-card-copy">
              {es
                ? "Utilice el correo y la contraseña de su cuenta autorizada."
                : "Use the email and password for your authorized account."}
            </p>
            {params.error === "1" && (
              <div role="alert" className="portal-login-error">
                {es
                  ? "No pudimos iniciar sesión. Revise sus credenciales e inténtelo de nuevo."
                  : "We could not sign you in. Check your credentials and try again."}
              </div>
            )}
            <form action="/api/portal/session" method="post" className="portal-login-form">
              <input type="hidden" name="lang" value={lang} />
              <label htmlFor="portal-email">{es ? "Correo electrónico" : "Email address"}</label>
              <input
                id="portal-email"
                name="email"
                type="email"
                required
                maxLength={254}
                autoComplete="username"
                placeholder="nombre@empresa.com"
              />
              <label htmlFor="portal-password">{es ? "Contraseña" : "Password"}</label>
              <input
                id="portal-password"
                name="password"
                type="password"
                required
                minLength={12}
                maxLength={256}
                autoComplete="current-password"
              />
              <button type="submit">
                {es ? "Entrar a mi espacio" : "Enter my space"}
                <ArrowRight size={19} aria-hidden="true" />
              </button>
            </form>
            <p className="portal-login-help">
              {es
                ? "¿No tiene acceso? Solicite una cuenta al equipo FHC."
                : "Need access? Request an account from the FHC team."}
            </p>
          </section>
        </div>
        <div className="portal-login-bottom">
          <Link href={`/${q}`}>← {es ? "Volver al inicio" : "Back to home"}</Link>
          <span>Ferdinand Herrera Consultores · Oculis Auribus</span>
        </div>
      </div>
    </main>
  );
}

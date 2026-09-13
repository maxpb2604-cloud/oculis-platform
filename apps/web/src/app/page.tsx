import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CheckCircle, FileMagnifyingGlass, ShieldCheck } from "@/components/ui/icons";
import { LandingShowcase } from "@/components/landing-showcase";
import { parseLang } from "@/lib/i18n";

export const dynamic = "force-dynamic";
type PageProps = { searchParams: Promise<{ lang?: string }> };

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const es = parseLang((await searchParams).lang) === "es";
  return {
    title: es ? "Inteligencia legislativa con evidencia" : "Legislative intelligence with evidence",
    description: es
      ? "Oculis Auribus organiza movimientos legislativos, agendas de comisiones e iniciativas regulatorias de la República Dominicana con vínculos a sus fuentes oficiales."
      : "Oculis Auribus organizes Dominican legislative movements, committee agendas, and regulatory initiatives with links to official sources.",
  };
}

export default async function LandingPage({ searchParams }: PageProps) {
  const lang = parseLang((await searchParams).lang);
  const es = lang === "es";
  const q = es ? "" : "?lang=en";

  return (
    <main className="landing-page">
      <section className="landing-hero" aria-labelledby="landing-title">
        <Image
          src="/congreso-nacional.jpg"
          alt={
            es
              ? "Fachada del Congreso Nacional de la República Dominicana"
              : "Facade of the Dominican Republic National Congress"
          }
          fill
          priority
          sizes="100vw"
          className="landing-hero-photo"
        />
        <div className="landing-hero-shade" aria-hidden="true" />
        <div className="landing-container landing-hero-content">
          <header className="landing-nav">
            <Link href={`/${q}`} aria-label="Oculis Auribus" className="landing-brand">
              <span className="landing-brand-symbol">
                <Image src="/oculis-mark.png" alt="" width={1119} height={474} />
              </span>
              <span className="landing-brand-name">
                OCULIS <span>AURIBUS</span>
              </span>
            </Link>
            <nav
              aria-label={es ? "Navegación de portada" : "Landing navigation"}
              className="landing-nav-links"
            >
              <a href="#plataforma">{es ? "La plataforma" : "The platform"}</a>
              <a href="#metodo">{es ? "Nuestro método" : "Our method"}</a>
              <Link className="landing-nav-login" href={`/login${q}`}>
                {es ? "Iniciar sesión" : "Sign in"} <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </nav>
          </header>

          <div className="landing-hero-grid">
            <div className="landing-hero-copy">
              <p className="landing-eyebrow landing-eyebrow-light">
                <span className="landing-eyebrow-line" aria-hidden="true" />
                {es ? "MONITOREO LEGISLATIVO Y REGULATORIO" : "LEGISLATIVE & REGULATORY MONITORING"}
              </p>
              <h1 id="landing-title">
                {es ? (
                  <>
                    Lo que cambia en el país, <em>claro para usted.</em>
                  </>
                ) : (
                  <>
                    What changes in the country, <em>clear to you.</em>
                  </>
                )}
              </h1>
              <p className="landing-lead">
                {es
                  ? "Siga las iniciativas, los movimientos del Congreso y las agendas de comisiones en un solo lugar. Cada dato importante conserva el camino hacia su fuente oficial."
                  : "Follow initiatives, congressional movements, and committee agendas in one place. Every important fact keeps a path back to its official source."}
              </p>
              <div className="landing-hero-actions">
                <Link href={`/login${q}`} className="landing-button landing-button-primary">
                  {es ? "Entrar a Oculis" : "Enter Oculis"}{" "}
                  <ArrowRight size={20} aria-hidden="true" />
                </Link>
                <a href="#plataforma" className="landing-button landing-button-ghost">
                  {es ? "Conocer la plataforma" : "Explore the platform"}
                </a>
              </div>
              <p className="landing-hero-note">
                <ShieldCheck size={17} aria-hidden="true" />
                {es
                  ? "Información respaldada por fuentes públicas oficiales"
                  : "Information backed by official public sources"}
              </p>
            </div>

            <div
              className="landing-signal-card"
              aria-label={es ? "Vista de capacidades de Oculis" : "Oculis capabilities preview"}
            >
              <div className="landing-signal-top">
                <span className="landing-signal-pulse" aria-hidden="true" />
                <span>{es ? "UNA LECTURA MÁS CLARA" : "A CLEARER VIEW"}</span>
                <span aria-hidden="true">✦</span>
              </div>
              {[
                es ? "Movimientos legislativos" : "Legislative movements",
                es ? "Comisiones y agendas" : "Committees and agendas",
                es ? "Actividad regulatoria" : "Regulatory activity",
              ].map((label, index) => (
                <div className="landing-signal-line" key={label}>
                  <span>0{index + 1}</span>
                  <strong>{label}</strong>
                  <ArrowRight size={18} aria-hidden="true" />
                </div>
              ))}
              <div className="landing-signal-foot">
                <CheckCircle size={17} weight="fill" aria-hidden="true" />
                {es
                  ? "Del hecho publicado a la decisión informada"
                  : "From published fact to informed decision"}
              </div>
            </div>
          </div>
          <div className="landing-hero-bottom">
            <span>{es ? "REPÚBLICA DOMINICANA" : "DOMINICAN REPUBLIC"}</span>
            <a href="#plataforma">
              {es ? "DESLICE PARA EXPLORAR" : "SCROLL TO EXPLORE"} <span aria-hidden="true">↓</span>
            </a>
          </div>
        </div>
      </section>

      <section
        id="plataforma"
        className="landing-platform landing-container"
        aria-labelledby="platform-title"
      >
        <div className="landing-section-heading">
          <p className="landing-eyebrow">
            <span className="landing-eyebrow-line" aria-hidden="true" />
            {es ? "EL PANORAMA COMPLETO" : "THE FULL PICTURE"}
          </p>
          <h2 id="platform-title">
            {es ? (
              <>
                Todo el contexto. <em>Sin perder la fuente.</em>
              </>
            ) : (
              <>
                The whole picture. <em>Without losing the source.</em>
              </>
            )}
          </h2>
          <p>
            {es
              ? "Explore las áreas de Oculis y descubra cómo una publicación oficial se convierte en información más fácil de seguir."
              : "Explore Oculis and see how an official publication becomes easier to follow."}
          </p>
        </div>
        <LandingShowcase lang={lang} />
      </section>

      <section id="metodo" className="landing-method" aria-labelledby="method-title">
        <div className="landing-container landing-method-grid">
          <div>
            <p className="landing-eyebrow">
              <span className="landing-eyebrow-line" aria-hidden="true" />
              {es ? "NUESTRA FORMA DE TRABAJAR" : "HOW WE WORK"}
            </p>
            <h2 id="method-title">
              {es ? (
                <>
                  Primero el documento. <em>Después, la interpretación.</em>
                </>
              ) : (
                <>
                  The document first. <em>Interpretation second.</em>
                </>
              )}
            </h2>
          </div>
          <div className="landing-method-copy">
            <FileMagnifyingGlass size={32} weight="duotone" aria-hidden="true" />
            <p>
              {es
                ? "Oculis distingue lo que la institución publicó de lo que aún no informó. Las fechas, los estados y los documentos se muestran con su procedencia para que usted pueda comprobarlos."
                : "Oculis distinguishes what an institution published from what it has not reported. Dates, statuses, and documents retain their provenance so you can verify them."}
            </p>
            <Link href={`/estado-fuentes${q}`} className="landing-inline-link">
              {es ? "Ver fuentes y cobertura" : "View sources and coverage"}{" "}
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      <section
        className="landing-final-cta landing-container"
        aria-labelledby="landing-final-title"
      >
        <div>
          <p className="landing-eyebrow">
            <span className="landing-eyebrow-line" aria-hidden="true" />
            {es ? "SU ESPACIO EN OCULIS" : "YOUR SPACE IN OCULIS"}
          </p>
          <h2 id="landing-final-title">
            {es ? "Entre con su cuenta y vea lo que importa." : "Sign in and see what matters."}
          </h2>
          <p>
            {es
              ? "El equipo FHC y cada cliente acceden con sus propias credenciales."
              : "The FHC team and each client access Oculis with their own credentials."}
          </p>
        </div>
        <Link href={`/login${q}`} className="landing-button landing-button-primary">
          {es ? "Iniciar sesión" : "Sign in"} <ArrowRight size={19} aria-hidden="true" />
        </Link>
      </section>
      <footer className="landing-footer">
        <div className="landing-container landing-footer-inner">
          <span>© {new Date().getFullYear()} Ferdinand Herrera Consultores · Oculis Auribus</span>
          <a
            href="https://commons.wikimedia.org/wiki/File:Palacio_del_Congreso_Nacional_Santo_Domingo.jpg"
            target="_blank"
            rel="noopener noreferrer"
          >
            {es
              ? "Foto: Peteremueller / Wikimedia Commons · CC BY-SA 4.0 · encuadre y color adaptados"
              : "Photo: Peteremueller / Wikimedia Commons · CC BY-SA 4.0 · framing and color adapted"}
          </a>
        </div>
      </footer>
    </main>
  );
}

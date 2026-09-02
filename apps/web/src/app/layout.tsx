import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono, Manrope } from "next/font/google";
import { headers } from "next/headers";
import { LANG_REQUEST_HEADER, parseLang } from "@/lib/i18n";
import "./globals.css";

const displayFont = Archivo({
  axes: ["wdth"],
  display: "swap",
  subsets: ["latin", "latin-ext"],
  variable: "--font-oculis-display",
  weight: "variable",
});

const interfaceFont = Manrope({
  display: "swap",
  subsets: ["latin", "latin-ext"],
  variable: "--font-oculis-interface",
  weight: "variable",
});

const technicalFont = IBM_Plex_Mono({
  display: "swap",
  subsets: ["latin", "latin-ext"],
  variable: "--font-oculis-technical",
  weight: ["400", "500"],
});

export async function generateMetadata(): Promise<Metadata> {
  const lang = parseLang((await headers()).get(LANG_REQUEST_HEADER));
  return {
    title: {
      default:
        lang === "es"
          ? "Oculis Auribus — Monitoreo legislativo y regulatorio"
          : "Oculis Auribus — Legislative and regulatory monitoring",
      template: "%s | Oculis Auribus",
    },
    description:
      lang === "es"
        ? "Información legislativa y regulatoria oficial de República Dominicana, organizada para comprender cambios, agendas y evidencia pública."
        : "Official legislative and regulatory information from the Dominican Republic, organized to understand changes, agendas, and public evidence.",
    applicationName: "Oculis Auribus",
    category: "business intelligence",
    icons: { icon: "/oculis-mark.png", apple: "/oculis-mark.png" },
  };
}

// Set the saved theme before paint. The selected editorial system is light by default.
const themeScript = `
(function(){try{var t=localStorage.getItem('fhc-theme');
var d=t?t==='dark':false;
if(d)document.documentElement.classList.add('dark');}catch(e){}})();
`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = parseLang((await headers()).get(LANG_REQUEST_HEADER));
  return (
    <html
      lang={lang}
      className={`${displayFont.variable} ${interfaceFont.variable} ${technicalFont.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

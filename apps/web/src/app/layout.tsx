import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter, Source_Serif_4 } from "next/font/google";
import "./globals.css";

export const metadata: Metadata = {
  title: "Oculis Auribus — Monitoreo Legislativo y Regulatorio",
  description: "Ferdinand Herrera Consultants — seguimiento experto de legislación y regulaciones en República Dominicana.",
};

// Self-hosted via next/font: no render-blocking Google-Fonts stylesheet, no
// third-party request on page load. globals.css maps these variables onto the
// theme's --font-sans/--font-serif/--font-mono tokens.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const serif = Source_Serif_4({ subsets: ["latin"], variable: "--font-source-serif" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono" });

// Set the theme class before paint to avoid a flash (respects saved choice / OS).
const themeScript = `
(function(){try{var t=localStorage.getItem('fhc-theme');
var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;
if(d)document.documentElement.classList.add('dark');}catch(e){}})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning className={`${inter.variable} ${serif.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

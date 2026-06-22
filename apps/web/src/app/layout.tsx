import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Oculis Auribus — Monitoreo Legislativo y Regulatorio",
  description: "Seguimiento experto de legislación y regulaciones en República Dominicana.",
};

// Set the theme class before paint to avoid a flash (respects saved choice / OS).
const themeScript = `
(function(){try{var t=localStorage.getItem('oculis-theme');
var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;
if(d)document.documentElement.classList.add('dark');}catch(e){}})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600;8..60,700&display=swap"
        />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

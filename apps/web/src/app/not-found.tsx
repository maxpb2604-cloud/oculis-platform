import Link from "next/link";
import Image from "next/image";
import { headers } from "next/headers";
import React from "react";
import { LANG_REQUEST_HEADER, parseLang } from "@/lib/i18n";

export default async function NotFound() {
  const lang = parseLang((await headers()).get(LANG_REQUEST_HEADER));
  const es = lang === "es";
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <section className="card elev w-full max-w-lg p-8 text-center">
        <Image
          src="/oculis-lockup.png"
          alt="Oculis Auribus"
          width={210}
          height={100}
          className="mx-auto h-auto w-44"
          priority
        />
        <p className="eyebrow mt-6">Error 404</p>
        <h1 className="serif mt-2 text-2xl font-semibold">
          {es ? "Página no encontrada" : "Page not found"}
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
          {es
            ? "La ruta solicitada no existe o fue movida."
            : "The requested page does not exist or has been moved."}
        </p>
        <Link
          href={es ? "/" : "/?lang=en"}
          className="mt-6 inline-flex rounded-lg px-4 py-2 text-sm font-semibold"
          style={{ background: "var(--accent)", color: "white" }}
        >
          {es ? "Volver al tablero inicial" : "Back to the main dashboard"}
        </Link>
      </section>
    </main>
  );
}

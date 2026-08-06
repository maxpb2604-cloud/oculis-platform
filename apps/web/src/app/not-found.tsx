import Link from "next/link";
import Image from "next/image";

export default function NotFound() {
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
        <h1 className="serif mt-2 text-2xl font-semibold">Página no encontrada</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
          La ruta solicitada no existe o fue movida.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex rounded-lg px-4 py-2 text-sm font-semibold"
          style={{ background: "var(--accent)", color: "white" }}
        >
          Volver al resumen
        </Link>
      </section>
    </main>
  );
}

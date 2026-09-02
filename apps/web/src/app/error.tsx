"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Route-level error boundary (App Router). Catches render/data errors in any segment
 * without its own boundary and shows a graceful, retryable fallback instead of a hard
 * crash. Bilingual: reads the current query through the App Router so the first rendered
 * fallback already honors the active language instead of flashing Spanish after mount.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const searchParams = useSearchParams();
  const es = searchParams.get("lang") !== "en";
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="card max-w-md p-8 text-center">
        <h2 className="serif text-xl font-semibold">
          {es ? "Algo salió mal" : "Something went wrong"}
        </h2>
        <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
          {es
            ? "Ocurrió un error al cargar esta página. Puedes reintentar."
            : "An error occurred loading this page. You can retry."}
        </p>
        <button
          onClick={reset}
          className="mt-5 rounded-lg px-4 py-2 text-sm font-medium"
          style={{ background: "var(--accent)", color: "#fff", cursor: "pointer" }}
        >
          {es ? "Reintentar" : "Try again"}
        </button>
        {error.digest && (
          <p className="mt-3 text-[11px]" style={{ color: "var(--text-muted)" }}>
            Ref: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}

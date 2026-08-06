export default function Loading() {
  return (
    <main
      aria-live="polite"
      aria-busy="true"
      className="flex min-h-dvh items-center justify-center p-6 text-center"
    >
      <p className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
        Cargando Oculis…
      </p>
    </main>
  );
}

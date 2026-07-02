/**
 * Route-level loading boundary. Every page is server-rendered per request
 * (force-dynamic), so navigation had zero feedback until the new page landed —
 * this shows a neutral, theme-aware pulse immediately.
 */
export default function Loading() {
  return (
    <div className="flex min-h-dvh items-center justify-center" aria-busy="true">
      <div className="flex items-center gap-2">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-2.5 w-2.5 animate-pulse rounded-full"
            style={{ background: "var(--accent)", animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

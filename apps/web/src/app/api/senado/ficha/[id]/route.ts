import { NextRequest, NextResponse } from "next/server";
import { SenadoSilAdapter } from "@oculis/scrapers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Authenticated proxy for the Senate's legacy "Sistema de Gestión de Expedientes
 * Digitales" Ficha. A direct browser click is blocked (the page needs a login session),
 * so our server logs in as the public-consultation user, fetches the Ficha, and serves it
 * with a <base> tag so relative assets/links resolve against the Senate origin. Result:
 * the user opens the full, up-to-date initiative record directly — block bypassed.
 *
 * GET /api/senado/ficha/:id  (id = IdExpediente)
 */

// Short in-memory cache so repeat opens don't re-login (the legacy login is ~4 requests).
const CACHE = new Map<string, { html: string; at: number }>();
const TTL_MS = 5 * 60_000;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "bad_id" }, { status: 400 });

  const cached = CACHE.get(id);
  const fresh = cached && Date.now() - cached.at < TTL_MS;
  let html: string;
  try {
    html = fresh ? cached!.html : await new SenadoSilAdapter().fetchFicha(id);
  } catch (e) {
    return new NextResponse(
      `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:2rem;color:#333">` +
        `<h2>No se pudo abrir el expediente del Senado</h2><p>${(e as Error).message}</p>` +
        `<p>El Sistema de Gestión de Expedientes Digitales puede estar caído. Intente de nuevo.</p></body>`,
      { status: 502, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
  if (!fresh) CACHE.set(id, { html, at: Date.now() });

  const base = `${SenadoSilAdapter.BASE}/`;
  const patched = html
    // Resolve relative assets/links against the legacy app.
    .replace(/<head([^>]*)>/i, `<head$1><base href="${base}">`)
    // Strip the IE-era window maximize/resize script so it doesn't fight the new tab.
    .replace(/function\s+resize\s*\(\)[\s\S]*?\}/i, "function resize(){}")
    .replace(/window\.(moveTo|resizeTo)\([^)]*\)/gi, "void 0");

  return new NextResponse(patched, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, max-age=120",
      // Allow the legacy http assets to load when our app is served over http (dev).
      "referrer-policy": "no-referrer",
    },
  });
}

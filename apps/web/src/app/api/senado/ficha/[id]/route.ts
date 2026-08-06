import { NextRequest, NextResponse } from "next/server";
import { SenadoSilAdapter } from "@oculis/scrapers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only view of the Senate's legacy "Sistema de Gestión de Expedientes Digitales"
 * public-consultation record. Remote executable content is removed and the response is
 * isolated with a CSP sandbox before it is served from the Oculis origin.
 *
 * GET /api/senado/ficha/:id  (id = IdExpediente)
 */

// Short in-memory cache so repeat opens don't re-login (the legacy login is ~4 requests).
const CACHE = new Map<string, { html: string; at: number }>();
const IN_FLIGHT = new Map<string, Promise<string>>();
const TTL_MS = 5 * 60_000;
const CACHE_MAX = 50;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 12;
const RATE = new Map<string, { startedAt: number; count: number }>();

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const retryAfter = checkRateLimit(req);
  if (retryAfter != null) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(retryAfter), "cache-control": "no-store" } },
    );
  }
  const { id } = await params;
  if (!/^\d{1,10}$/.test(id)) return NextResponse.json({ error: "bad_id" }, { status: 400 });

  const cached = CACHE.get(id);
  const fresh = cached && Date.now() - cached.at < TTL_MS;
  let html: string;
  try {
    if (fresh) {
      html = cached.html;
    } else {
      let request = IN_FLIGHT.get(id);
      if (!request) {
        request = new SenadoSilAdapter().fetchFicha(id);
        IN_FLIGHT.set(id, request);
      }
      try {
        html = await request;
      } finally {
        IN_FLIGHT.delete(id);
      }
    }
  } catch (e) {
    const message = escapeHtml(e instanceof Error ? e.message : "Error desconocido");
    return new NextResponse(
      `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:2rem;color:#333">` +
        `<h2>No se pudo abrir el expediente del Senado</h2><p>${message}</p>` +
        `<p>La solicitud no se completó; intente de nuevo.</p></body>`,
      { status: 502, headers: secureHtmlHeaders("no-store") },
    );
  }
  if (!fresh) {
    const now = Date.now();
    for (const [key, value] of CACHE) {
      if (now - value.at >= TTL_MS) CACHE.delete(key);
    }
    CACHE.set(id, { html, at: now });
    while (CACHE.size > CACHE_MAX) {
      const oldest = CACHE.keys().next().value as string | undefined;
      if (!oldest) break;
      CACHE.delete(oldest);
    }
  }

  const base = `${SenadoSilAdapter.BASE}/`;
  const patched = stripExecutableHtml(html)
    // Resolve relative assets/links against the legacy app.
    .replace(/<head([^>]*)>/i, `<head$1><base href="${base}">`)
    .replace(/<html([^>]*)>/i, `<html$1 lang="es">`);

  return new NextResponse(patched, {
    headers: secureHtmlHeaders("private, max-age=120"),
  });
}

function checkRateLimit(req: NextRequest): number | null {
  const key = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const current = RATE.get(key);
  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    RATE.set(key, { startedAt: now, count: 1 });
  } else {
    current.count += 1;
    if (current.count > RATE_MAX) {
      return Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - current.startedAt)) / 1000));
    }
  }
  if (RATE.size > 500) {
    for (const [candidate, value] of RATE) {
      if (now - value.startedAt >= RATE_WINDOW_MS) RATE.delete(candidate);
    }
  }
  return null;
}

function stripExecutableHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<(iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(iframe|object|embed)\b[^>]*\/?\s*>/gi, "")
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, "")
    .replace(/<form\b[^>]*>/gi, "<div>")
    .replace(/<\/form\s*>/gi, "</div>")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\b(?:javascript|data\s*:\s*text\/html)\s*:/gi, "blocked:");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character]!;
  });
}

function secureHtmlHeaders(cacheControl: string): Record<string, string> {
  return {
    "content-type": "text/html; charset=utf-8",
    "cache-control": cacheControl,
    "content-security-policy":
      "sandbox; default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline' https: http:; font-src data: https: http:",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
}

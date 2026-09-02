import { NextRequest, NextResponse } from "next/server";
import { SenadoSilAdapter } from "@oculis/scrapers";
import { prepareSenadoFichaHtml } from "@/lib/senado-ficha-html";
import type { Lang } from "@/lib/i18n";

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
const CACHE = new Map<string, { preparedHtml: string; at: number }>();
const IN_FLIGHT = new Map<string, Promise<string>>();
const TTL_MS = 5 * 60_000;
const CACHE_MAX = 20;
const MAX_HTML_CHARACTERS = 2_000_000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 12;
let RATE = { startedAt: 0, count: 0 };

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestedLang = validatedRequestLang(req);
  const responseLang: Lang = req.nextUrl.searchParams.get("lang") === "en" ? "en" : "es";
  if (!requestedLang) {
    return localizedErrorResponse(
      responseLang,
      400,
      responseLang === "es" ? "Solicitud no válida" : "Invalid request",
      responseLang === "es"
        ? "El enlace de la ficha contiene parámetros no admitidos."
        : "The record link contains unsupported parameters.",
    );
  }
  const lang = requestedLang;
  const { id } = await params;
  if (!/^\d{1,10}$/.test(id)) {
    return localizedErrorResponse(
      lang,
      400,
      lang === "es" ? "Identificador no válido" : "Invalid identifier",
      lang === "es"
        ? "La ficha solicitada no tiene un identificador válido del Senado."
        : "The requested record does not have a valid Senate identifier.",
    );
  }

  const cacheKey = `${id}:${lang}`;
  const cached = CACHE.get(cacheKey);
  const fresh = cached && Date.now() - cached.at < TTL_MS;
  if (fresh) {
    return new NextResponse(cached.preparedHtml, {
      headers: secureHtmlHeaders("private, max-age=120"),
    });
  }
  let preparedHtml: string;
  try {
    let request = IN_FLIGHT.get(cacheKey);
    if (!request) {
      const retryAfter = checkRateLimit();
      if (retryAfter != null) {
        return localizedErrorResponse(
          lang,
          429,
          lang === "es" ? "Demasiadas solicitudes" : "Too many requests",
          lang === "es"
            ? "Espere un momento antes de volver a abrir una ficha del Senado."
            : "Please wait a moment before opening another Senate record.",
          retryAfter,
        );
      }
      request = new SenadoSilAdapter()
        .fetchFicha(id, {
          timeoutMs: 12_000,
          totalTimeoutMs: 30_000,
        })
        .then((html) => {
          if (html.length > MAX_HTML_CHARACTERS) {
            throw new Error("La ficha del Senado excede el límite de tamaño permitido");
          }
          return prepareSenadoFichaHtml(html, lang);
        });
      IN_FLIGHT.set(cacheKey, request);
    }
    try {
      preparedHtml = await request;
    } finally {
      IN_FLIGHT.delete(cacheKey);
    }
  } catch (e) {
    console.error("Senate legacy-record proxy failed", e);
    return localizedErrorResponse(
      lang,
      502,
      lang === "es"
        ? "No se pudo abrir el expediente del Senado"
        : "The Senate record could not be opened",
      lang === "es"
        ? "La solicitud no se completó. Intente de nuevo."
        : "The request could not be completed. Please try again.",
    );
  }
  const now = Date.now();
  for (const [key, value] of CACHE) {
    if (now - value.at >= TTL_MS) CACHE.delete(key);
  }
  CACHE.set(cacheKey, { preparedHtml, at: now });
  while (CACHE.size > CACHE_MAX) {
    const oldest = CACHE.keys().next().value as string | undefined;
    if (!oldest) break;
    CACHE.delete(oldest);
  }

  return new NextResponse(preparedHtml, {
    headers: secureHtmlHeaders("private, max-age=120"),
  });
}

/** The public proxy accepts only its canonical optional language parameter. */
function validatedRequestLang(req: NextRequest): Lang | null {
  if ([...req.nextUrl.searchParams.keys()].some((key) => key !== "lang")) return null;
  const values = req.nextUrl.searchParams.getAll("lang");
  if (values.length === 0) return "es";
  if (values.length !== 1) return null;
  return values[0] === "es" || values[0] === "en" ? values[0] : null;
}

function localizedErrorResponse(
  lang: Lang,
  status: number,
  title: string,
  detail: string,
  retryAfter?: number,
): NextResponse {
  const headers = secureHtmlHeaders("no-store");
  if (retryAfter != null) headers["retry-after"] = String(retryAfter);
  const html =
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>` +
    `</head><body><main><p>Oculis Auribus</p><h1>${escapeHtml(title)}</h1>` +
    `<p>${escapeHtml(detail)}</p></main></body></html>`;
  return new NextResponse(html, { status, headers });
}

function checkRateLimit(): number | null {
  // This route is intentionally limited per server instance. A client-supplied
  // forwarding header must never create arbitrary limiter buckets or bypass the cap.
  const now = Date.now();
  if (now - RATE.startedAt >= RATE_WINDOW_MS) {
    RATE = { startedAt: now, count: 1 };
  } else {
    RATE.count += 1;
    if (RATE.count > RATE_MAX) {
      return Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - RATE.startedAt)) / 1000));
    }
  }
  return null;
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
      "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'; connect-src 'none'; img-src data:; style-src 'none'; font-src data:; media-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
}

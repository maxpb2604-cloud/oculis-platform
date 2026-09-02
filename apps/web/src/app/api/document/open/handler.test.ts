import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createOfficialDocumentOpenHandler, type OfficialDocumentOpenRecord } from "./handler";

const OFFICIAL_URL = "https://www.diputadosrd.gob.do/documentos/proyecto.pdf";

function storedDocument(
  over: Partial<OfficialDocumentOpenRecord> = {},
): OfficialDocumentOpenRecord {
  return {
    id: 42,
    initiativeId: 7,
    initiativeSourceId: "158654",
    initiativeCode: "06192-2024-2028-CD",
    initiativeTitle: "Proyecto de ley de prueba",
    source: "sil-diputados",
    sourceDocId: "official-text-42",
    docType: "Proyecto depositado",
    url: OFFICIAL_URL,
    uploadedAt: "2026-08-01",
    modifiedAt: null,
    pdfAvailable: true,
    ...over,
  };
}

function requestFor(
  documentId = 42,
  initiativeId = 7,
  extra: Record<string, string> = {},
): Request {
  const query = new URLSearchParams({
    documentId: String(documentId),
    initiativeId: String(initiativeId),
    ...extra,
  });
  return new Request(`http://localhost/api/document/open?${query.toString()}`);
}

function pdfResponse(): Response {
  return new Response(new TextEncoder().encode("%PDF-1.7\nsmall probe"), {
    status: 206,
    headers: { "content-type": "application/pdf", "content-range": "bytes 0-19/400" },
  });
}

function handlerWith(
  fetchImpl: typeof fetch,
  options: { timeoutMs?: number; rateMax?: number; maxConcurrent?: number } = {},
) {
  const lookupDocument = vi.fn(async (documentId: number, initiativeId: number) =>
    documentId === 42 && initiativeId === 7 ? storedDocument() : null,
  );
  const handler = createOfficialDocumentOpenHandler({ lookupDocument, fetchImpl, ...options });
  return { handler, lookupDocument };
}

describe("official Diputados document opener", () => {
  it("loads the stored row and redirects only after MIME and PDF magic validation", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        expect(String(input)).toBe(OFFICIAL_URL);
        expect(init?.redirect).toBe("manual");
        expect(new Headers(init?.headers).get("range")).toBe("bytes=0-16383");
        return pdfResponse();
      },
    );
    const { handler, lookupDocument } = handlerWith(fetchMock as typeof fetch);

    const response = await handler(requestFor());

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(OFFICIAL_URL);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(lookupDocument).toHaveBeenCalledTimes(2);
    expect(lookupDocument).toHaveBeenNthCalledWith(1, 42, 7);
  });

  it("opens an audited historical label served as generic binary after PDF magic validation", async () => {
    const lookupDocument = vi.fn(async () =>
      storedDocument({ docType: "P DEPOSITADO", pdfAvailable: false }),
    );
    const fetchMock = vi.fn(async () =>
      Promise.resolve(
        new Response(new TextEncoder().encode("%PDF-1.4\nhistorical official file"), {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        }),
      ),
    );
    const handler = createOfficialDocumentOpenHandler({
      lookupDocument,
      fetchImpl: fetchMock as typeof fetch,
    });

    const response = await handler(requestFor());
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(OFFICIAL_URL);
    expect(lookupDocument).toHaveBeenCalledTimes(2);
  });

  it("rejects client URL/source parameters and unknown ids before any fetch", async () => {
    const fetchMock = vi.fn(async () => Promise.resolve(pdfResponse()));
    const { handler, lookupDocument } = handlerWith(fetchMock as typeof fetch);

    const clientTarget = await handler(
      requestFor(42, 7, { url: "https://www.diputadosrd.gob.do/arbitrary.pdf" }),
    );
    expect(clientTarget.status).toBe(400);
    expect(lookupDocument).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    const missing = await handler(requestFor(999, 7));
    expect(missing.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("verifies listed official metadata on demand before opening it", async () => {
    const fetchMock = vi.fn(async () => Promise.resolve(pdfResponse()));
    const lookupDocument = vi.fn(async () => storedDocument({ pdfAvailable: false }));
    const handler = createOfficialDocumentOpenHandler({
      lookupDocument,
      fetchImpl: fetchMock as typeof fetch,
    });

    const response = await handler(requestFor());
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(OFFICIAL_URL);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(lookupDocument).toHaveBeenCalledTimes(2);
  });

  it("does not redirect for an empty response without a PDF MIME type", async () => {
    const fetchMock = vi.fn(async () =>
      Promise.resolve(new Response(null, { status: 200, headers: { "content-length": "0" } })),
    );
    const { handler } = handlerWith(fetchMock as typeof fetch);

    const response = await handler(requestFor());

    expect(response.status).toBe(422);
    expect(response.headers.has("location")).toBe(false);
    expect(await response.text()).toContain("No se abrió el documento oficial");
  });

  it("keeps a near-match HTML response in the generic invalid-PDF state", async () => {
    const fetchMock = vi.fn(async () =>
      Promise.resolve(
        new Response("Este archivo no existe", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      ),
    );
    const { handler } = handlerWith(fetchMock as typeof fetch);

    const response = await handler(requestFor());

    expect(response.status).toBe(422);
    expect(response.headers.has("location")).toBe(false);
    expect(await response.text()).toContain("contenido que no es un PDF verificable");
  });

  it("renders a bounded source-pending recovery page for the exact official missing-file body", async () => {
    const fetchMock = vi.fn(async () =>
      Promise.resolve(
        new Response("Este archivo no existe.", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      ),
    );
    const { handler } = handlerWith(fetchMock as typeof fetch);

    const response = await handler(requestFor());
    const html = await response.text();

    expect(response.status).toBe(422);
    expect(response.headers.has("location")).toBe(false);
    expect(response.headers.get("retry-after")).toBe("15");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("content-security-policy")).toContain("script-src 'none'");
    const recoveryStyle = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
    expect(recoveryStyle).toBeTruthy();
    const recoveryStyleHash = createHash("sha256").update(recoveryStyle!).digest("base64");
    const expectedStyleDirective = `style-src 'sha256-${recoveryStyleHash}'`;
    expect(response.headers.get("content-security-policy")).toContain(expectedStyleDirective);
    expect(
      readFileSync(new URL("../../../../../next.config.mjs", import.meta.url), "utf8"),
    ).toContain(expectedStyleDirective);
    expect(html).toContain("El PDF oficial todavía no está disponible");
    expect(html).toContain("Puede tratarse de una publicación pendiente");
    expect(html).toContain(
      'href="/api/document/open?documentId=42&amp;initiativeId=7">Reintentar</a>',
    );
    expect(html).toContain('href="/initiatives/7">Volver a la iniciativa</a>');
    expect(html).toContain('href="https://www.diputadosrd.gob.do/sil/iniciativa/158654"');
    expect(html).not.toContain("<script");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps the source-pending recovery links bilingual and omits an invalid official id", async () => {
    const lookupDocument = vi.fn(async () =>
      storedDocument({
        initiativeSourceId: '158654"><script>alert(1)</script>',
        initiativeCode: '<img src=x onerror="alert(1)">',
        initiativeTitle: "<script>alert(2)</script>",
      }),
    );
    const fetchMock = vi.fn(async () =>
      Promise.resolve(
        new Response("Este archivo no existe.", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      ),
    );
    const handler = createOfficialDocumentOpenHandler({
      lookupDocument,
      fetchImpl: fetchMock as typeof fetch,
    });

    const response = await handler(requestFor(42, 7, { lang: "en" }));
    const html = await response.text();

    expect(response.status).toBe(422);
    expect(response.headers.has("location")).toBe(false);
    expect(html).toContain("The official PDF is not available yet");
    expect(html).toContain(
      'href="/api/document/open?documentId=42&amp;initiativeId=7&amp;lang=en">Try again</a>',
    );
    expect(html).toContain('href="/initiatives/7?lang=en">Back to the initiative</a>');
    expect(html).not.toContain("https://www.diputadosrd.gob.do/sil/iniciativa/");
    expect(html).not.toContain("alert(1)");
    expect(html).not.toContain("alert(2)");
    expect(html).not.toContain("<script");
  });

  it("rejects a redirect to a non-official host without following it", async () => {
    const fetchMock = vi.fn(async () =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/proyecto.pdf" },
        }),
      ),
    );
    const { handler } = handlerWith(fetchMock as typeof fetch);

    const response = await handler(requestFor());

    expect(response.status).toBe(422);
    expect(response.headers.has("location")).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("times out a stalled official source and returns a clear non-redirect response", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Timed out", "AbortError"));
          });
        }),
    );
    const { handler } = handlerWith(fetchMock as typeof fetch, { timeoutMs: 10 });

    const response = await handler(requestFor());

    expect(response.status).toBe(504);
    expect(response.headers.has("location")).toBe(false);
    expect(await response.text()).toContain("no respondió dentro del tiempo de seguridad");
  });

  it("shares in-flight probes and caches by the current stored snapshot", async () => {
    let release: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      async (): Promise<Response> =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const { handler } = handlerWith(fetchMock as typeof fetch);

    const first = handler(requestFor());
    const second = handler(requestFor());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    release!(pdfResponse());
    expect((await first).status).toBe(302);
    expect((await second).status).toBe(302);
    expect((await handler(requestFor())).status).toBe(302);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not redirect if stored metadata changes during the probe", async () => {
    const before = storedDocument();
    const after = storedDocument({
      url: "https://www.diputadosrd.gob.do/documentos/replaced.pdf",
      modifiedAt: "2026-08-02",
    });
    const lookupDocument = vi
      .fn<
        (documentId: number, initiativeId: number) => Promise<OfficialDocumentOpenRecord | null>
      >()
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);
    const fetchMock = vi.fn(async () => Promise.resolve(pdfResponse()));
    const handler = createOfficialDocumentOpenHandler({
      lookupDocument,
      fetchImpl: fetchMock as typeof fetch,
    });

    const response = await handler(requestFor());

    expect(response.status).toBe(409);
    expect(response.headers.has("location")).toBe(false);
  });

  it("uses the successful live probe even when background extraction availability changes", async () => {
    const lookupDocument = vi
      .fn<
        (documentId: number, initiativeId: number) => Promise<OfficialDocumentOpenRecord | null>
      >()
      .mockResolvedValueOnce(storedDocument())
      .mockResolvedValueOnce(storedDocument({ pdfAvailable: false }));
    const fetchMock = vi.fn(async () => Promise.resolve(pdfResponse()));
    const handler = createOfficialDocumentOpenHandler({
      lookupDocument,
      fetchImpl: fetchMock as typeof fetch,
    });

    const response = await handler(requestFor());

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(OFFICIAL_URL);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(lookupDocument).toHaveBeenCalledTimes(2);
  });

  it("does not open a document that was reassigned away from the initiative in a stale tab", async () => {
    const lookupDocument = vi.fn(async (_documentId: number, _initiativeId: number) =>
      storedDocument({ initiativeId: 8, url: "https://www.diputadosrd.gob.do/documentos/b.pdf" }),
    );
    const fetchMock = vi.fn(async () => Promise.resolve(pdfResponse()));
    const handler = createOfficialDocumentOpenHandler({
      lookupDocument,
      fetchImpl: fetchMock as typeof fetch,
    });

    const response = await handler(requestFor(42, 7));

    expect(response.status).toBe(404);
    expect(response.headers.has("location")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rate-limits distinct stored-document cache misses", async () => {
    const fetchMock = vi.fn(async () => Promise.resolve(pdfResponse()));
    const lookupDocument = vi.fn(async (id: number, initiativeId: number) =>
      (id === 42 || id === 43) && initiativeId === 7
        ? storedDocument({
            id,
            sourceDocId: `official-text-${id}`,
            url: `https://www.diputadosrd.gob.do/documentos/proyecto-${id}.pdf`,
          })
        : null,
    );
    const handler = createOfficialDocumentOpenHandler({
      lookupDocument,
      fetchImpl: fetchMock as typeof fetch,
      rateMax: 1,
    });

    expect((await handler(requestFor(42, 7))).status).toBe(302);
    const limited = await handler(requestFor(43, 7));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

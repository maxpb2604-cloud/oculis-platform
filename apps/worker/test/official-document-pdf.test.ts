import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  MAX_PDF_BYTES,
  PDF_REACHABILITY_PREFIX_BYTES,
  officialDocumentDomains,
  prepareOfficialPdf,
  verifyOfficialPdfBinary,
  verifyOfficialPdfBinaryWithRetry,
} from "../src/official-document-pdf.js";

const OFFICIAL_URL =
  "https://s-sil.camaradediputados.gob.do:8095/ReportesGenerales/VerDocumento?documentoId=77";
const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nmock-complete-pdf");
const DOCUMENT_TEXT =
  "Este es el texto íntegro de un proyecto de ley oficial usado exclusivamente para probar la verificación documental sin llamadas externas.";

function responseAt(
  url: string,
  body: ConstructorParameters<typeof Response>[0] = PDF_BYTES,
  init: ResponseInit = { status: 200, headers: { "content-type": "application/pdf" } },
): Response {
  const response = new Response(body, init);
  Object.defineProperty(response, "url", { configurable: true, value: url });
  return response;
}

describe("official PDF validation", () => {
  it("accepts only an HTTPS official source/final host and hashes every PDF byte", async () => {
    let fetches = 0;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      fetches++;
      assert.equal(String(input), OFFICIAL_URL);
      assert.equal(init?.redirect, "manual");
      return responseAt(OFFICIAL_URL);
    }) as typeof fetch;
    const result = await prepareOfficialPdf(OFFICIAL_URL, {
      allowedDomains: officialDocumentDomains("sil-diputados"),
      fetchImpl,
      extractor: async (bytes) => {
        assert.deepEqual(bytes, PDF_BYTES);
        return { text: DOCUMENT_TEXT, pages: 3 };
      },
    });

    assert.equal(fetches, 1);
    assert.equal(result.contentHash, createHash("sha256").update(PDF_BYTES).digest("hex"));
    assert.equal(result.contentText, DOCUMENT_TEXT);
    assert.equal(result.characterCount, DOCUMENT_TEXT.length);
    assert.equal(result.pageCount, 3);
  });

  it("accepts generic binary MIME only when the official response has PDF magic", async () => {
    const result = await prepareOfficialPdf(OFFICIAL_URL, {
      allowedDomains: officialDocumentDomains("sil-diputados"),
      fetchImpl: (async () =>
        responseAt(OFFICIAL_URL, PDF_BYTES, {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        })) as typeof fetch,
      extractor: async () => ({ text: DOCUMENT_TEXT, pages: 1 }),
    });
    assert.equal(result.mimeType, "application/pdf");

    await assert.rejects(
      prepareOfficialPdf(OFFICIAL_URL, {
        allowedDomains: officialDocumentDomains("sil-diputados"),
        fetchImpl: (async () =>
          responseAt(OFFICIAL_URL, new TextEncoder().encode("not-a-pdf"), {
            status: 200,
            headers: { "content-type": "application/octet-stream" },
          })) as typeof fetch,
      }),
      /magic bytes/,
    );
  });

  it("uses a bounded Range prefix for fast 206 reachability and records Content-Range size", async () => {
    const result = await verifyOfficialPdfBinary(OFFICIAL_URL, {
      allowedDomains: officialDocumentDomains("sil-diputados"),
      fetchImpl: (async (_input, init) => {
        assert.equal(
          new Headers(init?.headers).get("range"),
          `bytes=0-${PDF_REACHABILITY_PREFIX_BYTES - 1}`,
        );
        return responseAt(OFFICIAL_URL, PDF_BYTES, {
          status: 206,
          headers: {
            "content-type": "application/pdf",
            "content-range": `bytes 0-${PDF_BYTES.byteLength - 1}/300000001`,
          },
        });
      }) as typeof fetch,
    });
    assert.equal(result.httpStatus, 206);
    assert.equal(result.byteSize, 300_000_001);
    assert.equal(result.contentHash, null);
    assert.equal(result.completeBody, false);
  });

  it("cancels a 200 response after the prefix and does not reject a declared file over 256 MB", async () => {
    let cancelled = false;
    const oversizedChunk = new Uint8Array(PDF_REACHABILITY_PREFIX_BYTES + 200);
    oversizedChunk.set(new TextEncoder().encode("%PDF-1.7"));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(oversizedChunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const result = await verifyOfficialPdfBinary(OFFICIAL_URL, {
      allowedDomains: officialDocumentDomains("sil-diputados"),
      fetchImpl: (async () =>
        responseAt(OFFICIAL_URL, body, {
          status: 200,
          headers: {
            "content-type": "application/pdf",
            "content-length": "300000001",
          },
        })) as typeof fetch,
    });
    assert.equal(result.byteSize, 300_000_001);
    assert.equal(result.bytes.byteLength, PDF_REACHABILITY_PREFIX_BYTES);
    assert.equal(result.completeBody, false);
    assert.equal(cancelled, true);
  });

  it("preserves byte size and hash when a PDF extractor detaches its input buffer", async () => {
    const result = await prepareOfficialPdf(OFFICIAL_URL, {
      allowedDomains: officialDocumentDomains("sil-diputados"),
      fetchImpl: (async () => responseAt(OFFICIAL_URL)) as typeof fetch,
      extractor: async (bytes) => {
        if (!(bytes.buffer instanceof ArrayBuffer)) throw new Error("expected owned ArrayBuffer");
        structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
        assert.equal(bytes.byteLength, 0);
        return { text: DOCUMENT_TEXT, pages: 2 };
      },
    });
    assert.equal(result.byteSize, PDF_BYTES.byteLength);
    assert.equal(result.contentHash, createHash("sha256").update(PDF_BYTES).digest("hex"));
  });

  it("rejects an unapproved source, host, HTTPS-to-HTTP redirect, and cross-domain redirect", async () => {
    assert.throws(() => officialDocumentDomains("unknown-source"), /no está autorizada/);
    await assert.rejects(
      prepareOfficialPdf("https://evil.example/document.pdf", {
        allowedDomains: officialDocumentDomains("sil-diputados"),
        fetchImpl: (async () => {
          throw new Error("must not fetch");
        }) as typeof fetch,
      }),
      /no pertenece a la fuente oficial/,
    );
    await assert.rejects(
      prepareOfficialPdf(OFFICIAL_URL, {
        allowedDomains: officialDocumentDomains("sil-diputados"),
        fetchImpl: (async () =>
          responseAt(OFFICIAL_URL, null, {
            status: 302,
            headers: {
              location: "http://s-sil.camaradediputados.gob.do/document.pdf",
            },
          })) as typeof fetch,
      }),
      /HTTPS sin downgrade/,
    );
    await assert.rejects(
      prepareOfficialPdf(OFFICIAL_URL, {
        allowedDomains: officialDocumentDomains("sil-diputados"),
        fetchImpl: (async () => responseAt("https://cdn.example/document.pdf")) as typeof fetch,
      }),
      /no pertenece a la fuente oficial/,
    );
  });

  it("requires application/pdf, %PDF- magic bytes, nonempty text, and visible limits", async () => {
    await assert.rejects(
      prepareOfficialPdf(OFFICIAL_URL, {
        allowedDomains: officialDocumentDomains("sil-diputados"),
        fetchImpl: (async () =>
          responseAt(OFFICIAL_URL, PDF_BYTES, {
            status: 200,
            headers: { "content-type": "text/html" },
          })) as typeof fetch,
      }),
      /MIME PDF/,
    );
    await assert.rejects(
      prepareOfficialPdf(OFFICIAL_URL, {
        allowedDomains: officialDocumentDomains("sil-diputados"),
        fetchImpl: (async () =>
          responseAt(OFFICIAL_URL, new TextEncoder().encode("not-a-pdf"))) as typeof fetch,
      }),
      /magic bytes/,
    );
    await assert.rejects(
      prepareOfficialPdf(OFFICIAL_URL, {
        allowedDomains: officialDocumentDomains("sil-diputados"),
        fetchImpl: (async () => responseAt(OFFICIAL_URL)) as typeof fetch,
        extractor: async () => ({ text: "   ", pages: 1 }),
      }),
      /menos de 80 caracteres/,
    );
    await assert.rejects(
      prepareOfficialPdf(OFFICIAL_URL, {
        allowedDomains: officialDocumentDomains("sil-diputados"),
        fetchImpl: (async () =>
          responseAt(OFFICIAL_URL, PDF_BYTES, {
            status: 200,
            headers: {
              "content-type": "application/pdf",
              "content-length": String(MAX_PDF_BYTES + 1),
            },
          })) as typeof fetch,
      }),
      /excede el límite binario seguro/,
    );
  });

  it("keeps the timeout active while streaming and enforces the byte limit without Content-Length", async () => {
    await assert.rejects(
      prepareOfficialPdf(OFFICIAL_URL, {
        allowedDomains: officialDocumentDomains("sil-diputados"),
        timeoutMs: 5,
        fetchImpl: (async (_input, init) => {
          const body = new ReadableStream<Uint8Array>({
            start(streamController) {
              init?.signal?.addEventListener("abort", () =>
                streamController.error(new DOMException("aborted", "AbortError")),
              );
            },
          });
          return responseAt(OFFICIAL_URL, body, {
            status: 200,
            headers: { "content-type": "application/pdf" },
          });
        }) as typeof fetch,
      }),
      /No se pudo descargar el PDF/,
    );

    const oversizedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("%PDF-"));
        controller.enqueue(new Uint8Array(8));
        controller.close();
      },
    });
    await assert.rejects(
      prepareOfficialPdf(OFFICIAL_URL, {
        allowedDomains: officialDocumentDomains("sil-diputados"),
        fetchImpl: (async () =>
          responseAt(OFFICIAL_URL, oversizedBody, {
            status: 200,
            headers: { "content-type": "application/pdf" },
          })) as typeof fetch,
        maxBytes: 8,
      }),
      /excede el límite binario seguro/,
    );
  });

  it("rejects HTML, an empty body, and zero/non-PDF prefix bytes", async () => {
    await assert.rejects(
      verifyOfficialPdfBinary(OFFICIAL_URL, {
        allowedDomains: officialDocumentDomains("sil-diputados"),
        fetchImpl: (async () =>
          responseAt(OFFICIAL_URL, "<html>no existe</html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          })) as typeof fetch,
      }),
      /MIME PDF/,
    );
    await assert.rejects(
      verifyOfficialPdfBinary(OFFICIAL_URL, {
        allowedDomains: officialDocumentDomains("sil-diputados"),
        fetchImpl: (async () =>
          responseAt(OFFICIAL_URL, null, {
            status: 200,
            headers: { "content-type": "application/pdf" },
          })) as typeof fetch,
      }),
      /no devolvió cuerpo/,
    );
    await assert.rejects(
      verifyOfficialPdfBinary(OFFICIAL_URL, {
        allowedDomains: officialDocumentDomains("sil-diputados"),
        fetchImpl: (async () =>
          responseAt(OFFICIAL_URL, new Uint8Array(32), {
            status: 200,
            headers: { "content-type": "application/pdf" },
          })) as typeof fetch,
      }),
      /magic bytes/,
    );
  });

  it("retries 503 and network failures with bounded backoff, then succeeds", async () => {
    for (const mode of ["http", "network"] as const) {
      let attempts = 0;
      const sleeps: number[] = [];
      const result = await verifyOfficialPdfBinaryWithRetry(OFFICIAL_URL, {
        allowedDomains: officialDocumentDomains("sil-diputados"),
        retryBaseDelayMs: 10,
        random: () => 0,
        sleep: async (delay) => {
          sleeps.push(delay);
        },
        fetchImpl: (async () => {
          attempts++;
          if (attempts < 3) {
            if (mode === "network") throw new TypeError("terminated");
            return responseAt(OFFICIAL_URL, "temporal", {
              status: 503,
              headers: { "content-type": "text/plain" },
            });
          }
          return responseAt(OFFICIAL_URL);
        }) as typeof fetch,
      });
      assert.equal(result.httpStatus, 200);
      assert.equal(attempts, 3);
      assert.deepEqual(sleeps, [10, 20]);
    }
  });

  it("surfaces three exhausted operational failures as retryable", async () => {
    let attempts = 0;
    await assert.rejects(
      verifyOfficialPdfBinaryWithRetry(OFFICIAL_URL, {
        allowedDomains: officialDocumentDomains("sil-diputados"),
        retryBaseDelayMs: 0,
        sleep: async () => {},
        fetchImpl: (async () => {
          attempts++;
          throw new TypeError("fetch failed");
        }) as typeof fetch,
      }),
      (error: unknown) =>
        error instanceof Error &&
        "retryable" in error &&
        error.retryable === true &&
        /No se pudo descargar/.test(error.message),
    );
    assert.equal(attempts, 3);
  });

  it("fails closed when PDF text extraction does not finish", async () => {
    await assert.rejects(
      prepareOfficialPdf(OFFICIAL_URL, {
        allowedDomains: officialDocumentDomains("sil-diputados"),
        fetchImpl: (async () => responseAt(OFFICIAL_URL)) as typeof fetch,
        parseTimeoutMs: 5,
        extractor: async () => new Promise<never>(() => {}),
      }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "PDF_PARSE_TIMEOUT" &&
        /excedió 5ms/.test(error.message),
    );
  });
});

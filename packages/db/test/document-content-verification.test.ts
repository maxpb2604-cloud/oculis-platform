import { expect, describe, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDb } from "../src/client.js";
import {
  listOfficialDepositedDocumentsForVerification,
  listDocuments,
  storeDocumentPdfVerification,
  storeDocumentContent,
  upsertDocument,
  upsertInitiative,
  verifyAndStoreDocumentContent,
  verifyAndStoreDocumentPdfReachability,
} from "../src/repository.js";
import { documentContents, documentPdfVerifications } from "../src/schema.js";
import type { PreparedDocumentContent } from "../src/repository.js";

function preparedContent(contentHash: string, contentText: string): PreparedDocumentContent {
  return {
    contentHash,
    contentText,
    mimeType: "application/pdf",
    byteSize: 2_048,
    pageCount: 2,
    characterCount: contentText.length,
  };
}

async function seedCandidate(db: ReturnType<typeof createDb>["db"], suffix: string) {
  const initiative = await upsertInitiative(db, {
    source: "sil-diputados",
    sourceId: `verification-lock-${suffix}`,
    kind: "LEGISLATIVE",
    code: `LOCK-${suffix.toUpperCase()}`,
    title: `Proyecto para probar lock ${suffix}`,
  });
  await upsertDocument(db, {
    source: "sil-diputados",
    sourceDocId: `verification-lock-document-${suffix}`,
    initiativeId: initiative.id,
    initiativeCode: `LOCK-${suffix.toUpperCase()}`,
    docType: "PROYECTO DEPOSITADO",
    extension: "pdf",
    url: `https://www.diputadosrd.gob.do/documentos/verification-lock-${suffix}.pdf`,
  });
  const [candidate] = await listOfficialDepositedDocumentsForVerification(db, {
    initiativeId: initiative.id,
    limit: 1,
  });
  if (!candidate) throw new Error("verification-lock fixture was not eligible");
  return { initiative, candidate };
}

describe("serialized official-document verification", () => {
  it("bootstraps the reachability table and backfills legacy validated contents", async () => {
    const handle = createDb();
    try {
      await handle.ensureSchema();
      const { candidate } = await seedCandidate(handle.db, "legacy-backfill");
      const content = preparedContent(
        "f".repeat(64),
        "Texto legado validado cuyos bytes PDF ya habían superado el contrato anterior.",
      );
      await storeDocumentContent(handle.db, {
        documentId: candidate.documentId,
        sourceSnapshot: candidate.sourceSnapshot,
        ...content,
      });
      await handle.db.execute(sql`drop table document_pdf_verifications`);

      await handle.ensureSchema();
      expect((await listDocuments(handle.db, candidate.initiativeId))[0]?.pdfAvailable).toBe(true);
      const [backfilled] = await handle.db
        .select()
        .from(documentPdfVerifications)
        .where(eq(documentPdfVerifications.documentId, candidate.documentId));
      expect(backfilled).toMatchObject({
        reachable: true,
        httpStatus: 200,
        mimeType: "application/pdf",
        byteSize: content.byteSize,
        finalUrl: candidate.url,
      });
    } finally {
      await handle.close();
    }
  });

  it("includes the audited historical deposited-text alias but not contextual prefixes", async () => {
    const handle = createDb();
    try {
      await handle.ensureSchema();
      const initiative = await upsertInitiative(handle.db, {
        source: "sil-diputados",
        sourceId: "historical-deposited-labels",
        kind: "LEGISLATIVE",
        code: "HISTORICAL-PDF",
        title: "Proyecto histórico con texto depositado",
      });
      await upsertDocument(handle.db, {
        source: "sil-diputados",
        sourceDocId: "historical-deposited-label",
        initiativeId: initiative.id,
        docType: "P DEPOSITADO",
        extension: "pdf",
        url: "https://s-sil.camaradediputados.gob.do:8095/ReportesGenerales/VerDocumento?documentoId=214727",
      });
      await upsertDocument(handle.db, {
        source: "sil-diputados",
        sourceDocId: "historical-contextual-label",
        initiativeId: initiative.id,
        docType: "PROYECTO DEPOSITADO PREVIO",
        extension: "pdf",
        url: "https://www.diputadosrd.gob.do/documentos/contextual-previo.pdf",
      });

      const candidates = await listOfficialDepositedDocumentsForVerification(handle.db, {
        initiativeId: initiative.id,
        limit: 10,
      });
      expect(candidates).toHaveLength(1);
      expect(candidates[0]?.sourceDocId).toBe("historical-deposited-label");
      expect(candidates[0]?.sourceSnapshot.docType).toBe("P DEPOSITADO");
    } finally {
      await handle.close();
    }
  });

  it(
    "does not let an older slow verification repromote stale bytes after a newer attempt",
    { timeout: 10_000 },
    async () => {
      const handle = createDb();
      try {
        await handle.ensureSchema();
        const { candidate } = await seedCandidate(handle.db, "ordering");
        const oldPrepared = preparedContent(
          "a".repeat(64),
          "Texto oficial íntegro de la versión anterior usado para comprobar el orden.",
        );
        const newPrepared = preparedContent(
          "b".repeat(64),
          "Texto oficial íntegro de la versión nueva usado para comprobar el orden.",
        );
        await storeDocumentContent(handle.db, {
          documentId: candidate.documentId,
          sourceSnapshot: candidate.sourceSnapshot,
          ...oldPrepared,
        });

        let releaseOld!: () => void;
        const holdOld = new Promise<void>((resolve) => {
          releaseOld = resolve;
        });
        let markOldEntered!: () => void;
        const oldEntered = new Promise<void>((resolve) => {
          markOldEntered = resolve;
        });
        let newerPrepareCalls = 0;

        const olderAttempt = verifyAndStoreDocumentContent(handle.db, {
          documentId: candidate.documentId,
          sourceSnapshot: candidate.sourceSnapshot,
          prepare: async () => {
            markOldEntered();
            await holdOld;
            return oldPrepared;
          },
        });
        await oldEntered;

        const newerAttempt = verifyAndStoreDocumentContent(handle.db, {
          documentId: candidate.documentId,
          sourceSnapshot: candidate.sourceSnapshot,
          prepare: async () => {
            newerPrepareCalls++;
            return newPrepared;
          },
        });
        const earlyNewerState = await Promise.race([
          newerAttempt.then(
            () => "completed",
            () => "rejected",
          ),
          new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 25)),
        ]);
        expect(earlyNewerState).toBe("blocked");
        expect(newerPrepareCalls).toBe(0);

        releaseOld();
        const [olderResult, newerResult] = await Promise.all([olderAttempt, newerAttempt]);
        expect(olderResult.prepared.contentHash).toBe(oldPrepared.contentHash);
        expect(newerResult.prepared.contentHash).toBe(newPrepared.contentHash);
        expect(newerPrepareCalls).toBe(1);

        const versions = await handle.db
          .select({
            contentHash: documentContents.contentHash,
            lastVerifiedAt: documentContents.lastVerifiedAt,
          })
          .from(documentContents)
          .where(eq(documentContents.documentId, candidate.documentId));
        const oldVersion = versions.find(
          (version) => version.contentHash === oldPrepared.contentHash,
        );
        const newVersion = versions.find(
          (version) => version.contentHash === newPrepared.contentHash,
        );
        expect(oldVersion).toBeDefined();
        expect(newVersion).toBeDefined();
        expect(newVersion!.lastVerifiedAt.getTime()).toBeGreaterThan(
          oldVersion!.lastVerifiedAt.getTime(),
        );
      } finally {
        await handle.close();
      }
    },
  );

  it(
    "revalidates existence and the exact source snapshot before prepare can fetch",
    { timeout: 10_000 },
    async () => {
      const handle = createDb();
      try {
        await handle.ensureSchema();
        const { candidate } = await seedCandidate(handle.db, "snapshot");
        let prepareCalls = 0;
        const prepare = async () => {
          prepareCalls++;
          return preparedContent("d".repeat(64), "Texto que nunca debe descargarse ni guardarse.");
        };

        await expect(
          verifyAndStoreDocumentContent(handle.db, {
            documentId: 2_147_483_647,
            sourceSnapshot: candidate.sourceSnapshot,
            prepare,
          }),
        ).rejects.toThrow(/document no longer exists/);
        await expect(
          verifyAndStoreDocumentContent(handle.db, {
            documentId: candidate.documentId,
            sourceSnapshot: {
              ...candidate.sourceSnapshot,
              url: "https://www.diputadosrd.gob.do/documentos/otra-version.pdf",
            },
            prepare,
          }),
        ).rejects.toThrow(/document metadata changed/);
        expect(prepareCalls).toBe(0);
      } finally {
        await handle.close();
      }
    },
  );

  it("fetches before opening its transaction and rejects metadata drift without stale evidence", async () => {
    const handle = createDb();
    try {
      await handle.ensureSchema();
      const { candidate } = await seedCandidate(handle.db, "binary-snapshot-drift");
      const revisedUrl =
        "https://www.diputadosrd.gob.do/documentos/verification-lock-binary-snapshot-drift-v2.pdf";
      await expect(
        verifyAndStoreDocumentPdfReachability(handle.db, {
          documentId: candidate.documentId,
          sourceSnapshot: candidate.sourceSnapshot,
          verify: async () => {
            await upsertDocument(handle.db, {
              source: candidate.source,
              sourceDocId: candidate.sourceDocId,
              initiativeId: candidate.initiativeId,
              docType: candidate.sourceSnapshot.docType,
              extension: "pdf",
              url: revisedUrl,
            });
            return {
              httpStatus: 200 as const,
              mimeType: "application/pdf" as const,
              byteSize: null,
              finalUrl: candidate.url,
            };
          },
        }),
      ).rejects.toThrow(/document metadata changed/);
      expect(
        await handle.db
          .select()
          .from(documentPdfVerifications)
          .where(eq(documentPdfVerifications.documentId, candidate.documentId)),
      ).toHaveLength(0);
      expect((await listDocuments(handle.db, candidate.initiativeId))[0]?.pdfAvailable).toBe(false);
    } finally {
      await handle.close();
    }
  });

  it("persists a reachability failure independently and replaces prior success", async () => {
    const handle = createDb();
    try {
      await handle.ensureSchema();
      const { candidate } = await seedCandidate(handle.db, "binary-failure");
      await verifyAndStoreDocumentPdfReachability(handle.db, {
        documentId: candidate.documentId,
        sourceSnapshot: candidate.sourceSnapshot,
        verify: async () => ({
          httpStatus: 206 as const,
          mimeType: "application/octet-stream" as const,
          byteSize: null,
          finalUrl: candidate.url,
        }),
      });
      expect((await listDocuments(handle.db, candidate.initiativeId))[0]?.pdfAvailable).toBe(true);

      await expect(
        verifyAndStoreDocumentPdfReachability(handle.db, {
          documentId: candidate.documentId,
          sourceSnapshot: candidate.sourceSnapshot,
          verify: async () => {
            throw Object.assign(new Error("respuesta HTML"), { code: "INVALID_PDF_MIME" });
          },
        }),
      ).rejects.toThrow(/respuesta HTML/);
      expect((await listDocuments(handle.db, candidate.initiativeId))[0]?.pdfAvailable).toBe(false);
      const [verification] = await handle.db
        .select()
        .from(documentPdfVerifications)
        .where(eq(documentPdfVerifications.documentId, candidate.documentId));
      expect(verification).toMatchObject({
        reachable: false,
        httpStatus: null,
        mimeType: null,
        byteSize: null,
        finalUrl: null,
        errorCode: "INVALID_PDF_MIME",
      });

      await expect(
        storeDocumentPdfVerification(handle.db, {
          documentId: candidate.documentId,
          sourceSnapshot: candidate.sourceSnapshot,
          reachable: false,
          httpStatus: 200,
          mimeType: "application/pdf",
          byteSize: 100,
          finalUrl: candidate.url,
          errorCode: "CONTRADICTORY",
          errorMessage: "No debe persistirse.",
        }),
      ).rejects.toThrow(/cannot contain positive response facts/);

      await storeDocumentPdfVerification(handle.db, {
        documentId: candidate.documentId,
        sourceSnapshot: candidate.sourceSnapshot,
        reachable: false,
        httpStatus: null,
        mimeType: null,
        byteSize: null,
        finalUrl: null,
        errorCode: "PDF_FETCH_FAILED",
        errorMessage: "No se pudo descargar el PDF: terminated",
      });
      await handle.ensureSchema();
      expect(
        await handle.db
          .select()
          .from(documentPdfVerifications)
          .where(eq(documentPdfVerifications.documentId, candidate.documentId)),
      ).toHaveLength(0);
    } finally {
      await handle.close();
    }
  });
});

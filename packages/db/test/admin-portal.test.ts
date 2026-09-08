import { describe, expect, it } from "vitest";
import {
  addClientPortalUser,
  createAdminPortalUserIfAbsent,
  createDb,
  createPortalClient,
  listActiveAdminClients,
  listAdminClientSummaries,
  upsertClientInitiativeAssignment,
} from "../src/index.js";
import { initiatives, regulations } from "../src/schema.js";

describe("administrative client portal persistence", () => {
  it("keeps clients, users, and legislative/regulatory assignments separated and update-safe", async () => {
    const handle = createDb();
    try {
      await handle.ensureSchema();
      const admin = await createAdminPortalUserIfAbsent(handle.db, {
        email: "admin@fhc.test",
        displayName: "Equipo FHC",
        passwordHash: "hashed-for-repository-test",
      });
      const client = await createPortalClient(handle.db, {
        name: "Cliente de prueba",
        slug: "cliente-de-prueba",
      });
      await addClientPortalUser(handle.db, {
        clientId: client.id,
        email: "usuario@cliente.test",
        displayName: "Usuario Cliente",
        passwordHash: "scrypt-test-hash",
      });
      const [initiative] = await handle.db
        .insert(initiatives)
        .values({
          source: "admin-test-legislative",
          sourceId: "leg-1",
          kind: "LEGISLATIVE",
          code: "TEST-001",
          title: "Iniciativa legislativa de prueba",
        })
        .returning({ id: initiatives.id });
      const [regulation] = await handle.db
        .insert(regulations)
        .values({
          source: "admin-test-regulatory",
          sourceId: "reg-1",
          institution: "TEST",
          title: "Iniciativa regulatoria de prueba",
        })
        .returning({ id: regulations.id });

      const first = await upsertClientInitiativeAssignment(handle.db, {
        clientId: client.id,
        record: { kind: "LEGISLATIVE", recordId: initiative!.id },
        impactOnBusiness: "HIGH",
        executiveSupport: "SUPPORTS",
        keyStakeholderSupport: "MIXED",
        publicOpinion: "FAVORABLE",
        assignedByUserId: admin.id,
      });
      expect(first.created).toBe(true);
      const updated = await upsertClientInitiativeAssignment(handle.db, {
        clientId: client.id,
        record: { kind: "LEGISLATIVE", recordId: initiative!.id },
        impactOnBusiness: "MEDIUM",
        executiveSupport: "NEUTRAL",
        keyStakeholderSupport: "UNKNOWN",
        publicOpinion: "MIXED",
        internalNote: "Revisión actualizada",
        assignedByUserId: admin.id,
      });
      expect(updated).toEqual({ id: first.id, created: false });
      await upsertClientInitiativeAssignment(handle.db, {
        clientId: client.id,
        record: { kind: "REGULATORY", recordId: regulation!.id },
        impactOnBusiness: "LOW",
        executiveSupport: "UNKNOWN",
        keyStakeholderSupport: "OPPOSES",
        publicOpinion: "UNKNOWN",
        assignedByUserId: admin.id,
      });

      expect(await listActiveAdminClients(handle.db)).toEqual([client]);
      const [summary] = await listAdminClientSummaries(handle.db);
      expect(summary?.users).toEqual([
        expect.objectContaining({
          email: "usuario@cliente.test",
          activationPending: false,
        }),
      ]);
      expect(summary?.assignments).toHaveLength(2);
      expect(summary?.assignments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "LEGISLATIVE",
            code: "TEST-001",
            impactOnBusiness: "MEDIUM",
            internalNote: "Revisión actualizada",
          }),
          expect.objectContaining({
            kind: "REGULATORY",
            institution: "TEST",
            impactOnBusiness: "LOW",
          }),
        ]),
      );
    } finally {
      await handle.close();
    }
  });
});

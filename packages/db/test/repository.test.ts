import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../src/client.js";
import {
  countApprovedBySponsor,
  countInitiatives,
  recordStatusEvents,
  upsertActivityEvent,
  upsertFeedItem,
  upsertInitiative,
} from "../src/repository.js";
import { activityInitiatives, feedItemEntities, initiatives } from "../src/schema.js";
import type { NewInitiative } from "../src/schema.js";

let h: DbHandle;

beforeAll(async () => {
  h = createDb(); // in-memory PGlite (no DATABASE_URL)
  await h.ensureSchema();
});
afterAll(async () => {
  await h.close();
});

function fixture(over: Partial<NewInitiative> = {}): NewInitiative {
  return {
    source: "sil-diputados",
    sourceId: "158418",
    kind: "LEGISLATIVE",
    code: "05956-2024-2028-CD",
    title: "Proyecto de ley de prueba",
    status: "Depositado",
    chamber: "DIPUTADOS",
    ...over,
  };
}

describe("upsertInitiative", () => {
  it("inserts once, then updates the same row (idempotent on source+sourceId)", async () => {
    const a = await upsertInitiative(h.db, fixture());
    expect(a.inserted).toBe(true);

    const b = await upsertInitiative(h.db, fixture({ status: "Depositado" }));
    expect(b.inserted).toBe(false);
    expect(b.statusChanged).toBe(false);
    expect(b.id).toBe(a.id);

    expect(await countInitiatives(h.db)).toBe(1);
  });

  it("detects a status change on re-ingest", async () => {
    const c = await upsertInitiative(h.db, fixture({ status: "En Comisión" }));
    expect(c.inserted).toBe(false);
    expect(c.statusChanged).toBe(true);
    expect(await countInitiatives(h.db)).toBe(1);
  });
});

describe("upsertInitiative enrichment preservation", () => {
  it("keeps enriched sponsor/party/province/committee when a re-crawl passes nulls", async () => {
    const enriched = fixture({
      sourceId: "enrich-1",
      code: "09999-2024-2028-CD",
      sponsor: "Juan Pérez",
      sponsorRole: "Diputado",
      sponsorCount: 5,
      party: "PRM",
      province: "Santiago",
      committee: "Hacienda",
      purpose: "Objeto de prueba",
    });
    const a = await upsertInitiative(h.db, enriched);
    expect(a.inserted).toBe(true);

    // a default (unenriched) crawl of the same bill carries nulls for these fields
    const b = await upsertInitiative(
      h.db,
      fixture({
        sourceId: "enrich-1",
        code: "09999-2024-2028-CD",
        status: "En Comisión",
        sponsor: null,
        party: null,
        province: null,
        committee: null,
        purpose: null,
      }),
    );
    expect(b.inserted).toBe(false);
    expect(b.id).toBe(a.id);

    const [row] = await h.db.select().from(initiatives).where(eq(initiatives.id, a.id));
    expect(row!.sponsor).toBe("Juan Pérez");
    expect(row!.sponsorRole).toBe("Diputado");
    expect(row!.sponsorCount).toBe(5);
    expect(row!.party).toBe("PRM");
    expect(row!.province).toBe("Santiago");
    expect(row!.committee).toBe("Hacienda");
    expect(row!.purpose).toBe("Objeto de prueba");
    expect(row!.status).toBe("En Comisión"); // non-enrichment fields still refresh
  });

  it("still refreshes enrichment fields on genuine value changes", async () => {
    const c = await upsertInitiative(
      h.db,
      fixture({ sourceId: "enrich-1", code: "09999-2024-2028-CD", sponsor: "María Gómez" }),
    );
    const [row] = await h.db.select().from(initiatives).where(eq(initiatives.id, c.id));
    expect(row!.sponsor).toBe("María Gómez");
  });
});

describe("recordStatusEvents", () => {
  it("dedupes identical (status, date) events across re-scrapes", async () => {
    const { id } = await upsertInitiative(h.db, fixture());
    const events = [
      { status: "Depositado", date: "2026-06-18", note: null },
      { status: "En Comisión", date: "2026-06-20", note: null },
    ];
    const first = await recordStatusEvents(h.db, id, events);
    expect(first).toBe(2);
    const second = await recordStatusEvents(h.db, id, events);
    expect(second).toBe(0); // all duplicates skipped
    const third = await recordStatusEvents(h.db, id, [
      { status: "En Pleno", date: "2026-06-25", note: null },
    ]);
    expect(third).toBe(1);
  });

  it("dedupes date-less events too (NULLS NOT DISTINCT unique index)", async () => {
    const { id } = await upsertInitiative(h.db, fixture());
    const events = [{ status: "Observado", date: null, note: null }];
    expect(await recordStatusEvents(h.db, id, events)).toBe(1);
    expect(await recordStatusEvents(h.db, id, events)).toBe(0); // would re-insert forever pre-fix
  });
});

describe("countApprovedBySponsor", () => {
  it("counts approved bills and can exclude the one being scored", async () => {
    const a = await upsertInitiative(
      h.db,
      fixture({ sourceId: "appr-1", code: null, sponsor: "Pedro Solano", status: "Aprobada" }),
    );
    await upsertInitiative(
      h.db,
      fixture({ sourceId: "appr-2", code: null, sponsor: "Pedro Solano", status: "Ley promulgada" }),
    );
    await upsertInitiative(
      h.db,
      fixture({ sourceId: "appr-3", code: null, sponsor: "Pedro Solano", status: "En Comisión" }),
    );
    expect(await countApprovedBySponsor(h.db, "Pedro Solano")).toBe(2);
    // the bill being scored must not count itself as prior track record
    expect(await countApprovedBySponsor(h.db, "Pedro Solano", { excludeId: a.id })).toBe(1);
    expect(await countApprovedBySponsor(h.db, null)).toBe(0);
  });
});

describe("upsertActivityEvent link reconciliation", () => {
  const base = {
    source: "sil-actividad",
    scope: "COMMITTEE" as const,
    chamber: "DIPUTADOS" as const,
    date: "2026-07-01",
    kind: "Reunión",
    body: "Comisión de Prueba",
    description: "Agenda de prueba",
    dedupeKey: "test-agenda-1",
    raw: {},
  };

  it("drops links for codes removed from an edited agenda", async () => {
    const first = await upsertActivityEvent(h.db, {
      ...base,
      initiativeCodes: ["00001-CD", "00002-CD"],
    });
    expect(first.inserted).toBe(true);

    const second = await upsertActivityEvent(h.db, { ...base, initiativeCodes: ["00002-CD"] });
    expect(second.inserted).toBe(false);
    expect(second.id).toBe(first.id);

    const links = await h.db
      .select({ code: activityInitiatives.initiativeCode })
      .from(activityInitiatives)
      .where(eq(activityInitiatives.activityId, first.id));
    expect(links.map((l) => l.code)).toEqual(["00002-CD"]);

    // an edit that removes every referenced bill clears all links
    await upsertActivityEvent(h.db, { ...base, initiativeCodes: [] });
    const none = await h.db
      .select({ code: activityInitiatives.initiativeCode })
      .from(activityInitiatives)
      .where(eq(activityInitiatives.activityId, first.id));
    expect(none).toHaveLength(0);
  });
});

describe("upsertFeedItem tag reconciliation", () => {
  const item = {
    source: "feed-test",
    sourceId: "post-1",
    kind: "NEWS",
    title: "Noticia de prueba",
  };

  it("removes stale entity tags on re-ingest and resolves initiative codes", async () => {
    const first = await upsertFeedItem(h.db, item, [
      { entityType: "INITIATIVE", initiativeCode: "05956-2024-2028-CD", label: "05956-2024-2028-CD" },
      { entityType: "LEGISLATOR", legislatorSourceId: "dip-1", label: "Juan Pérez" },
    ]);
    expect(first.inserted).toBe(true);

    let tags = await h.db
      .select()
      .from(feedItemEntities)
      .where(eq(feedItemEntities.feedItemId, first.id));
    expect(tags).toHaveLength(2);
    const billTag = tags.find((t) => t.entityType === "INITIATIVE");
    expect(billTag?.initiativeId).not.toBeNull(); // resolved to the ingested fixture bill

    // re-ingest produces only the legislator tag → the bill tag must be removed
    const second = await upsertFeedItem(h.db, item, [
      { entityType: "LEGISLATOR", legislatorSourceId: "dip-1", label: "Juan Pérez" },
    ]);
    expect(second.inserted).toBe(false);
    expect(second.id).toBe(first.id);

    tags = await h.db
      .select()
      .from(feedItemEntities)
      .where(eq(feedItemEntities.feedItemId, first.id));
    expect(tags).toHaveLength(1);
    expect(tags[0]!.entityType).toBe("LEGISLATOR");

    // re-ingest with no tags clears them all
    await upsertFeedItem(h.db, item, []);
    tags = await h.db
      .select()
      .from(feedItemEntities)
      .where(eq(feedItemEntities.feedItemId, first.id));
    expect(tags).toHaveLength(0);
  });
});

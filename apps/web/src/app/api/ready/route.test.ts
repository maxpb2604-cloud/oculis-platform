import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  close: vi.fn(),
  createDb: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@oculis/db", () => ({ createDb: dbMocks.createDb }));

import { GET } from "./route";

describe("GET /api/ready", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalInitiativeFloor = process.env.OCULIS_MIN_READY_INITIATIVES;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgresql://oculis:secret@127.0.0.1/oculis";
    process.env.OCULIS_MIN_READY_INITIATIVES = "9000";
    dbMocks.createDb.mockReturnValue({
      db: { execute: dbMocks.execute },
      close: dbMocks.close,
    });
    dbMocks.execute.mockResolvedValue({
      rows: [{ initiative_count: "9104", has_active_admin: true }],
    });
    dbMocks.close.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalInitiativeFloor === undefined) delete process.env.OCULIS_MIN_READY_INITIATIVES;
    else process.env.OCULIS_MIN_READY_INITIATIVES = originalInitiativeFloor;
  });

  it("returns ready only after PostgreSQL accepts a query", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(dbMocks.execute).toHaveBeenCalledOnce();
    expect(dbMocks.close).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      service: "oculis-web",
      database: "postgresql",
    });
  });

  it("returns a generic 503 and closes the handle when the query fails", async () => {
    dbMocks.execute.mockRejectedValue(new Error("contains internal connection details"));

    const response = await GET();

    expect(response.status).toBe(503);
    expect(dbMocks.close).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toEqual({
      status: "unavailable",
      service: "oculis-web",
      database: "unavailable",
    });
  });

  it("does not declare an empty freshly bootstrapped database ready", async () => {
    dbMocks.execute.mockResolvedValue({
      rows: [{ initiative_count: "0", has_active_admin: false }],
    });

    const response = await GET();

    expect(response.status).toBe(503);
    expect(dbMocks.close).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toEqual({
      status: "unavailable",
      service: "oculis-web",
      database: "unavailable",
    });
  });

  it("does not declare a severely incomplete database ready", async () => {
    dbMocks.execute.mockResolvedValue({
      rows: [{ initiative_count: "8999", has_active_admin: true }],
    });

    const response = await GET();

    expect(response.status).toBe(503);
    expect(dbMocks.close).toHaveBeenCalledOnce();
  });

  it("fails closed when the configured initiative floor is invalid", async () => {
    process.env.OCULIS_MIN_READY_INITIATIVES = "0";

    const response = await GET();

    expect(response.status).toBe(503);
    expect(dbMocks.createDb).not.toHaveBeenCalled();
  });

  it("does not fall back to PGlite when PostgreSQL is not configured", async () => {
    delete process.env.DATABASE_URL;

    const response = await GET();

    expect(response.status).toBe(503);
    expect(dbMocks.createDb).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      status: "unavailable",
      service: "oculis-web",
      database: "unavailable",
    });
  });
});

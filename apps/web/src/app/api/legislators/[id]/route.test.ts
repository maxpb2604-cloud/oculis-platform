import { beforeEach, describe, expect, it, vi } from "vitest";

const { getLegislatorProfileById } = vi.hoisted(() => ({
  getLegislatorProfileById: vi.fn(),
}));

vi.mock("@/lib/data", () => ({ getLegislatorProfileById }));

import { parseLegislatorProfileId } from "./input";
import { GET } from "./route";

const profile = {
  id: 42,
  active: true,
  source: "roster-diputados",
  sourceId: "7001",
  chamber: "DIPUTADOS",
  fullName: "Ada Pérez",
  province: "Santo Domingo",
  circumscription: "1",
  party: "Partido de prueba",
  partyShort: "PP",
  role: "Diputada",
  representationLevel: "Provincial",
  period: "2024-2028",
  photoUrl: "https://www.diputadosrd.gob.do/fotos/ada.jpg",
  email: null,
  phone: null,
  profession: null,
  sourceUrl: "https://www.diputadosrd.gob.do/sil/legislador/7001",
  committees: [{ name: "Comisión de prueba", cargo: "Miembro" }],
  initiativeStats: {
    availability: "observed",
    basis: "official-proponent-id",
    coverage: "partial",
    deposited: 12,
    active: 7,
    otherConditionOrUnpublished: 5,
  },
};

const request = (id: string, query = "") =>
  GET(new Request(`http://localhost/api/legislators/${id}${query}`), {
    params: Promise.resolve({ id }),
  });

describe("legislator profile API", () => {
  beforeEach(() => {
    getLegislatorProfileById.mockReset();
  });

  it("admits only canonical positive database identifiers", () => {
    expect(parseLegislatorProfileId("42")).toBe(42);
    expect(parseLegislatorProfileId("0")).toBeNull();
    expect(parseLegislatorProfileId("042")).toBeNull();
    expect(parseLegislatorProfileId("1.5")).toBeNull();
    expect(parseLegislatorProfileId("2147483648")).toBeNull();
    expect(parseLegislatorProfileId("Ada Pérez")).toBeNull();
  });

  it("returns one source-backed profile without redirecting", async () => {
    getLegislatorProfileById.mockResolvedValue(profile);

    const response = await request("42");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, max-age=300");
    expect(getLegislatorProfileById).toHaveBeenCalledWith(42);
    expect(payload.profile).toMatchObject({
      id: 42,
      fullName: "Ada Pérez",
      sourceUrl: "https://www.diputadosrd.gob.do/sil/legislador/7001",
      initiativeStats: {
        availability: "observed",
        basis: "official-proponent-id",
        coverage: "partial",
        deposited: 12,
        active: 7,
        otherConditionOrUnpublished: 5,
      },
    });
  });

  it("fails closed for invalid, missing, and untrusted profile data", async () => {
    expect((await request("Ada-Perez")).status).toBe(400);
    expect((await request("42", "?redirect=https://example.com")).status).toBe(400);
    expect(getLegislatorProfileById).not.toHaveBeenCalled();

    getLegislatorProfileById.mockResolvedValueOnce(null);
    expect((await request("42")).status).toBe(404);

    getLegislatorProfileById.mockResolvedValueOnce({
      ...profile,
      photoUrl: "http://127.0.0.1/private",
      sourceUrl: "https://example.com/not-official",
    });
    const sanitized = await request("42");
    const payload = await sanitized.json();
    expect(sanitized.status).toBe(200);
    expect(payload.profile.photoUrl).toBeNull();
    expect(payload.profile.sourceUrl).toBeNull();
  });
});

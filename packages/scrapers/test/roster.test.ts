import { describe, expect, it } from "vitest";
import { normalizeCargo } from "../src/roster.js";

describe("roster: normalizeCargo", () => {
  it("normalizes vicepresidente spellings (and prefers it over 'presidente' substring)", () => {
    expect(normalizeCargo("Vice-Presidente/a")).toBe("Vicepresidente");
    expect(normalizeCargo("VICEPRESIDENTE")).toBe("Vicepresidente");
    expect(normalizeCargo("Vicepresidenta")).toBe("Vicepresidente");
  });

  it("normalizes presidente spellings", () => {
    expect(normalizeCargo("PRESIDENTE")).toBe("Presidente");
    expect(normalizeCargo("Presidente/a")).toBe("Presidente");
    expect(normalizeCargo("Presidenta")).toBe("Presidente");
  });

  it("normalizes secretario spellings", () => {
    expect(normalizeCargo("Secretario/a")).toBe("Secretario");
    expect(normalizeCargo("SECRETARIA")).toBe("Secretario");
  });

  it("normalizes miembro spellings", () => {
    expect(normalizeCargo("MIEMBRO")).toBe("Miembro");
    expect(normalizeCargo("Miembro")).toBe("Miembro");
  });

  it("returns null for nullish input", () => {
    expect(normalizeCargo(null)).toBeNull();
    expect(normalizeCargo(undefined)).toBeNull();
    expect(normalizeCargo("")).toBeNull();
  });

  it("returns null for unrecognized cargos", () => {
    expect(normalizeCargo("Coordinador")).toBeNull();
    expect(normalizeCargo("xyz")).toBeNull();
  });
});

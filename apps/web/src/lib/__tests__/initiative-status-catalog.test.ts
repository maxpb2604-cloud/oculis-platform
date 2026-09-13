import { describe, expect, it } from "vitest";
import {
  catalogStatuses,
  statusSelectionLabel,
  statusVariantsForSelection,
} from "@/lib/initiative-status-catalog";

const officialValues = [
  "Depositada",
  "Depositado",
  "Aprobada en Primera lectura",
  "Aprobado en 1ra. lectura",
  "Aprobado en 2da. lectura",
  "Aprobada en Primera Con Modificaciones",
  "Aprobada en Unica Lectura Conformación Comisión Especial",
  "Enviada a Comisión",
  "Enviado a Comisión",
  "Enviado a Comisión en 2da. Discusión",
  "Informe Leído",
  "Informe Leído con Modificaciones",
  "En Archivo y Correspondencia",
  "Remitido a Archivo y Correspondencia",
  "Sobre la mesa",
  "Sobre la mesa 1era discusión",
  "Sobre la mesa para única discusión",
];

describe("initiative catalog status options", () => {
  it("groups only equivalent source spellings and keeps procedural qualifiers", () => {
    const options = catalogStatuses(officialValues, "es");
    expect(options).toHaveLength(14);
    expect(options.find((option) => option.label === "Iniciativa depositada")?.variants).toEqual([
      "Depositada",
      "Depositado",
    ]);
    expect(
      options.find((option) => option.label === "Aprobada en primera lectura")?.variants,
    ).toEqual(["Aprobada en Primera lectura", "Aprobado en 1ra. lectura"]);
    expect(options.map((option) => option.value)).toEqual([
      ...new Set(options.map((option) => option.value)),
    ]);
    expect(options.every((option) => option.known)).toBe(true);
  });

  it("expands a selected canonical option and an old source-literal link", () => {
    const options = catalogStatuses(officialValues, "es");
    const filed = options.find((option) => option.label === "Iniciativa depositada")!;
    expect(statusVariantsForSelection(officialValues, filed.value)).toEqual([
      "Depositada",
      "Depositado",
    ]);
    expect(statusVariantsForSelection(officialValues, "Depositado")).toEqual([
      "Depositada",
      "Depositado",
    ]);
    expect(statusSelectionLabel(officialValues, "Depositado", "es")).toBe("Iniciativa depositada");
    expect(statusVariantsForSelection(officialValues, "Un estado nuevo")).toEqual([
      "Un estado nuevo",
    ]);
  });
});

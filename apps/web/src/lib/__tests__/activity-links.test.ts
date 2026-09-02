import { describe, expect, it } from "vitest";
import {
  activityDestinationLabel,
  activityDetailHref,
  isOfficialCommissionRecordUrl,
  safeOfficialActivityUrl,
} from "@/lib/activity-links";

describe("activity destination labels", () => {
  it("does not label a commission record as an agenda", () => {
    const url = "https://www.diputadosrd.gob.do/sil/comision/42";
    expect(isOfficialCommissionRecordUrl(url)).toBe(true);
    expect(activityDestinationLabel(url, "es", "sil-actividad")).toBe("Abrir comisión oficial");
  });

  it("keeps the agenda label for an official agenda document", () => {
    const url = "https://www.senadord.gob.do/documentos/agenda.pdf";
    expect(isOfficialCommissionRecordUrl(url)).toBe(false);
    expect(activityDestinationLabel(url, "es", "senado")).toBe("Ver agenda oficial");
  });

  it("does not call a Senate attendance publication an agenda", () => {
    const url = "https://www.senadord.gob.do/Descargas/asistencia-del-mes-de-febrero-2026.pdf";
    expect(activityDestinationLabel(url, "es", "sen-attendance")).toBe("Abrir documento oficial");
  });

  it("creates a stable internal agenda destination", () => {
    expect(activityDetailHref(4, "es")).toBe("/agenda/4");
    expect(activityDetailHref(42, "es")).toBe("/agenda/42");
    expect(activityDetailHref(42, "en")).toBe("/agenda/42?lang=en");
  });

  it("accepts only an exact Diputados WPFD daily agenda and rejects technical JSON", () => {
    const exact =
      "https://camaradediputados.gob.do/wp-admin/admin-ajax.php?juwpfisadmin=false&action=wpfd&task=file.download&wpfd_category_id=2245&wpfd_file_id=28988&token=&preview=1";
    expect(safeOfficialActivityUrl(exact, "sil-actividad", "161253")).toBe(exact);
    expect(safeOfficialActivityUrl(exact, "sil-actividad", null)).toBe(exact);
    expect(
      safeOfficialActivityUrl(
        "https://www.diputadosrd.gob.do/sil/api/actividad/actividad/161253",
        "sil-actividad",
        "161253",
      ),
    ).toBeNull();
    expect(
      safeOfficialActivityUrl(
        "https://www.diputadosrd.gob.do/sil/comision/5243",
        "sil-actividad",
        "161253",
      ),
    ).toBeNull();
    expect(
      safeOfficialActivityUrl(
        "https://camaradediputados.gob.do/agenda-comisiones/#211-2245-wpfd-agosto-slo-2026",
        "sil-actividad",
        "161253",
      ),
    ).toBeNull();
    expect(
      safeOfficialActivityUrl(`${exact}&redirect=https://example.com`, "sil-actividad", "161253"),
    ).toBeNull();
    expect(
      safeOfficialActivityUrl(`${exact}&wpfd_file_id=7`, "sil-actividad", "161253"),
    ).toBeNull();
    expect(
      safeOfficialActivityUrl(exact.replace("https:", "http:"), "sil-actividad", "161253"),
    ).toBeNull();
    expect(activityDestinationLabel(exact, "es", "sil-actividad")).toBe(
      "Abrir agenda oficial del día",
    );
  });

  it("rejects broken Senate permalinks and accepts an exact WPFD preview", () => {
    const exact =
      "https://www.senadord.gob.do/wp-admin/admin-ajax.php?juwpfisadmin=false&action=wpfd&task=file.download&wpfd_category_id=1382&wpfd_file_id=61641&token=&preview=1";
    expect(safeOfficialActivityUrl(exact, "senado")).toBe(exact);
    expect(safeOfficialActivityUrl(exact.replace("https:", "http:"), "senado")).toBeNull();
    expect(safeOfficialActivityUrl(`${exact}&redirect=https://example.com`, "senado")).toBeNull();
    expect(safeOfficialActivityUrl(`${exact}&wpfd_file_id=7`, "senado")).toBeNull();
    expect(safeOfficialActivityUrl(`${exact}#unexpected`, "senado")).toBeNull();
    expect(
      safeOfficialActivityUrl(
        "https://www.senadord.gob.do/wpfd_file/agenda-semanal-de-comisiones/",
        "senado",
      ),
    ).toBeNull();
  });
});

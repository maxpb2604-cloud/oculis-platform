import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const calendarSource = readFileSync(
  fileURLToPath(new URL("../../components/commissions-agendas.tsx", import.meta.url)),
  "utf8",
);

describe("commission calendar day navigation", () => {
  it("opens selected month and week dates in the daily view", () => {
    expect(calendarSource).toContain('pageHref({ date: cell.iso, view: "day" })');
    expect(calendarSource).toContain('pageHref({ date: iso, view: "day" })');
    expect(calendarSource).not.toContain("pageHref({ date: cell.iso })");
    expect(calendarSource).not.toContain("pageHref({ date: iso })");
  });
});

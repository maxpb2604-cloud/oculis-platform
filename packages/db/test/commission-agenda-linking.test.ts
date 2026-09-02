import { describe, expect, it } from "vitest";
import { attachExactCommissionAgendas, type CommissionAgendaCandidate } from "../src/repository.js";

const disabilityCommission =
  "05368-2024-2028-CD Comisión especial designada para estudiar el Proyecto de ley que modifica la Ley núm.5-13 sobre Discapacidad en la República Dominicana.";

const roster = [
  {
    chamber: "DIPUTADOS",
    name: disabilityCommission,
    members: [{ name: "Representante de prueba", cargo: "Miembro", party: "PRM" }],
  },
];

function candidate(over: Partial<CommissionAgendaCandidate> = {}): CommissionAgendaCandidate {
  return {
    id: 4,
    chamber: "DIPUTADOS",
    body: disabilityCommission,
    eventDate: "2026-08-27",
    eventTime: "09:30:00",
    kind: "Reunión",
    ...over,
  };
}

describe("exact commission-to-agenda linking", () => {
  it("connects the normalized 05368 commission to the durable agenda 4 record", () => {
    const differentlyFormatted = disabilityCommission
      .toUpperCase()
      .replace("NÚM.5-13", "NÚM. 5-13");
    const [commission] = attachExactCommissionAgendas(roster, [
      candidate({ body: differentlyFormatted }),
    ]);

    expect(commission?.agendas).toEqual([
      {
        id: 4,
        eventDate: "2026-08-27",
        eventTime: "09:30:00",
        kind: "Reunión",
      },
    ]);
  });

  it("does not link substrings, suffix variants, cross-chamber rows, or rows without a date", () => {
    const falseMatches = [
      candidate({ id: 10, body: "05368-2024-2028-CD Comisión especial" }),
      candidate({ id: 11, body: `${disabilityCommission} Subcomisión` }),
      candidate({ id: 12, chamber: "SENADO" }),
      candidate({ id: 13, eventDate: "" }),
    ];

    expect(attachExactCommissionAgendas(roster, falseMatches)[0]?.agendas).toEqual([]);
  });

  it("fails closed when two roster names collapse to the same normalized identity", () => {
    const ambiguousRoster = [
      ...roster,
      { ...roster[0]!, name: disabilityCommission.replace("núm.5-13", "núm. 5-13") },
    ];

    expect(attachExactCommissionAgendas(ambiguousRoster, [candidate()])).toEqual(
      ambiguousRoster.map((commission) => ({ ...commission, agendas: [] })),
    );
  });
});

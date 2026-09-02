import { describe, expect, it } from "vitest";
import {
  explicitLegislatureCountingFacts,
  explicitInitiativeActivities,
  explicitInitiativeVotes,
  explicitProponents,
  initiativeSourceCoverage,
} from "@/lib/initiative-facts";

const enrichedRaw = {
  payload: {
    proponentes: [
      {
        legisladorId: 3621,
        nombres: "Indhira Shary",
        apellidos: "de Jesús de Morla",
        nombreCompleto: "Indhira Shary de Jesús de Morla",
        principal: true,
        representacion: {
          funcion: "Diputada",
          nivelRepresentacion: "Provincial",
          ejercicio: "En Curso",
          inicio: "2024-08-16T00:00:00",
          fin: "2028-08-15T00:00:00",
          periodo: "2024-2028",
          provincia: "Santo Domingo",
          circunscripcion: null,
          partido: {
            id: 2868,
            siglas: "PRM",
            nombre: "Partido Revolucionario Moderno",
          },
        },
      },
    ],
    actividades: [
      {
        id: 161253,
        actividad: "Reunión de la comisión",
        fecha: "2026-08-27T09:30:00",
        tipo: "Reunión de Comisión",
        ubicacion: "Salón Rafaela Alburquerque",
        comisionId: 5243,
      },
    ],
    votaciones: [
      {
        id: 22615,
        titulo: "Votación de la iniciativa",
        mocion: "Aprobar en primera lectura",
        fecha: "2026-08-27T12:00:00",
        numeroVotacion: "4",
        sesionId: 99,
        sesion: { numero: "17" },
        votos: {
          cantidadTotalVotos: 175,
          cantidadVotosSi: 170,
          cantidadVotosNo: 2,
          cantidadVotosAbastencion: 3,
        },
        asistencias: {
          cantidadDelegados: 190,
          cantidadPresentes: 175,
          cantidadAusentes: 15,
        },
      },
    ],
  },
  provenance: {
    endpoints: [
      "/sil/api/iniciativa/iniciativa/159665",
      "/sil/api/iniciativa/proponentes?page=1&id=159665",
      "/sil/api/iniciativa/historicos?page=1&id=159665",
      "/sil/api/iniciativa/comisiones?page=1&id=159665",
      "/sil/api/iniciativa/documentos?page=1&id=159665",
      "/sil/api/iniciativa/Actividades?page=1&id=159665",
      "/sil/api/iniciativa/votaciones?page=1&id=159665",
    ],
  },
};

describe("initiative public facts", () => {
  it("preserves the public representation facts for every proponent", () => {
    expect(explicitProponents(enrichedRaw)).toEqual([
      expect.objectContaining({
        name: "Indhira Shary de Jesús de Morla",
        legislatorId: 3621,
        principal: true,
        role: "Diputada",
        representationLevel: "Provincial",
        representationStatus: "En Curso",
        representationPeriod: "2024-2028",
        party: "PRM",
        partyName: "Partido Revolucionario Moderno",
        partyId: 2868,
        province: "Santo Domingo",
      }),
    ]);
  });

  it("maps official activities and aggregate votes without turning them into status events", () => {
    expect(explicitInitiativeActivities(enrichedRaw)).toEqual([
      expect.objectContaining({
        id: 161253,
        description: "Reunión de la comisión",
        commissionId: 5243,
      }),
    ]);
    expect(explicitInitiativeVotes(enrichedRaw)).toEqual([
      expect.objectContaining({
        id: 22615,
        totalVotes: 175,
        yesVotes: 170,
        noVotes: 2,
        abstentions: 3,
        present: 175,
        absent: 15,
      }),
    ]);
  });

  it("distinguishes a successfully observed empty collection from one never consulted", () => {
    expect(initiativeSourceCoverage(enrichedRaw, "sil-diputados")).toEqual({
      detail: true,
      proponents: true,
      history: true,
      commissions: true,
      documents: true,
      activities: true,
      votes: true,
    });
    expect(initiativeSourceCoverage({ payload: { comisiones: [] } }, "sil-diputados")).toEqual({
      detail: false,
      proponents: false,
      history: false,
      commissions: false,
      documents: false,
      activities: false,
      votes: false,
    });
  });

  it("reads only explicit legislature-counting fields from an archived Senate Ficha", () => {
    const raw = {
      payload: {
        list: { status: "Depositada", filedAt: "2026-08-28" },
        ficha: {
          legislatureCountingStarted: "No",
          legislatureCountingStartedAt: null,
          legislature: "2026-SLO",
          expiresAt: null,
        },
      },
    };

    expect(explicitLegislatureCountingFacts(raw, "senado-sil")).toEqual({
      initiated: "No",
      initiatedAt: null,
      legislature: "2026-SLO",
      expiresAt: null,
    });
    expect(explicitLegislatureCountingFacts(raw, "sil-diputados")).toEqual({
      initiated: null,
      initiatedAt: null,
      legislature: null,
      expiresAt: null,
    });
  });
});

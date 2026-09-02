import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  createDb,
  listInitiativeProponents,
  replaceRosterSnapshot,
  upsertInitiative,
} from "@oculis/db";
import {
  parseSenadoSilProponentCatalog,
  REVIEWED_SENADO_SIL_PERSON_BRIDGE,
  senateSilExactNameKey,
} from "@oculis/scrapers";
import {
  buildDiputadosProponentSnapshot,
  DIPUTADOS_SIL_PERSON_NAMESPACE,
  linkInitiativeProponents,
} from "../src/link-initiative-proponents.js";

function senateCatalogHtml(): string {
  const people = REVIEWED_SENADO_SIL_PERSON_BRIDGE.map(
    (row) => `<option value="${row.personSourceId}">${row.officialName}</option>`,
  ).join("");
  const institutions = Array.from(
    { length: 12 },
    (_, index) => `<option value="${9000 + index}">INSTITUCIÓN ${index + 1}</option>`,
  ).join("");
  return `<select id="lsbLista1">${people}</select><select id="lsbLista2">${institutions}</select>`;
}

/** Exact `fullName` snapshot emitted by the 32-profile official collector on 2026-09-02. */
const CURRENT_SENATE_ROSTER_2026_09_02 = [
  { sourceId: "azua", fullName: "Lía Ynocencia Díaz De Díaz" },
  { sourceId: "bahoruco", fullName: "Andrés Guillermo Lama Pérez" },
  { sourceId: "barahona", fullName: "Moisés Ayala Pérez" },
  { sourceId: "dajabon", fullName: "Manuel María Rodríguez Ortega" },
  { sourceId: "distrito-nacional", fullName: "Omar Leonel Fernández Domínguez" },
  { sourceId: "duarte", fullName: "Franklin Martín Romero Morillo" },
  { sourceId: "el-seibo", fullName: "Santiago José Zorrilla" },
  { sourceId: "elias-pina", fullName: "Jonhson Encarnación Díaz" },
  { sourceId: "espaillat", fullName: "Carlos Manuel Gómez Ureña" },
  {
    sourceId: "hato-mayor",
    fullName: "Cristobal Venerado Antonio Castillo Liriano",
  },
  { sourceId: "hermanas-mirabal", fullName: "María Mercedes Ortiz Diloné" },
  { sourceId: "independencia", fullName: "Dagoberto Rodríguez Adames" },
  { sourceId: "la-altagracia", fullName: "Rafael Barón Duluc Rijo" },
  { sourceId: "la-romana", fullName: "Eduard Alexis Espiritusanto Castillo" },
  { sourceId: "la-vega", fullName: "Ramón Rogelio Genao Durán" },
  { sourceId: "maria-trinidad-sanchez", fullName: "Alexis Victoria Yeb" },
  { sourceId: "monsenor-nouel", fullName: "Hector Elpidio Acosta Restituyo" },
  { sourceId: "monte-plata", fullName: "Pedro Antonio Tineo Núñez" },
  { sourceId: "montecristi", fullName: "Bernardo Alemán Rodríguez" },
  { sourceId: "pedernales", fullName: "Secundino Velázquez Pimentel" },
  { sourceId: "peravia", fullName: "Julito Fulcar Encarnación" },
  {
    sourceId: "puerto-plata",
    fullName: "Ginnette Altagracia Bournigal Socias De Jimenez",
  },
  { sourceId: "samana", fullName: "Pedro Manuel Catrain Bonilla" },
  { sourceId: "san-cristobal", fullName: "Gustavo Lara Salazar" },
  { sourceId: "san-jose-de-ocoa", fullName: "Milciades Aneudy Ortiz Sajiun" },
  { sourceId: "san-juan", fullName: "Félix Ramón Bautista Rosario" },
  {
    sourceId: "san-pedro-de-macoris",
    fullName: "Aracelis Villanueva Figueroa",
  },
  { sourceId: "sanchez-ramirez", fullName: "Ricardo De Los Santos Polanco" },
  { sourceId: "santiago", fullName: "Daniel Enrique De Jesús Rivera Reyes" },
  { sourceId: "santiago-rodriguez", fullName: "Casimiro Antonio Marte Familia" },
  { sourceId: "santo-domingo", fullName: "Antonio Manuel Taveras Guzman" },
  { sourceId: "valverde", fullName: "Odalís Rafael Rodríguez Rodríguez" },
] as const;

describe("initiative proponent reconciliation", () => {
  it("refreshes weekly Fichas and keeps bootstrap resumable before linker coverage", () => {
    const workflow = readFileSync(
      new URL("../../../.github/workflows/cloud-ingestion.yml", import.meta.url),
      "utf8",
    );
    const weeklyFichas = workflow.indexOf("id: weekly_senate_fichas");
    const weeklyLinks = workflow.indexOf("id: weekly_proponent_links");
    const bootstrapFichas = workflow.indexOf("id: bootstrap_senate_fichas");
    const bootstrapLinks = workflow.indexOf("id: bootstrap_proponent_links");
    assert.ok(weeklyFichas >= 0 && weeklyFichas < weeklyLinks);
    assert.ok(bootstrapFichas >= 0 && bootstrapFichas < bootstrapLinks);
    assert.match(workflow.slice(weeklyFichas, weeklyLinks), /senate:fichas:full/);
    assert.doesNotMatch(workflow.slice(weeklyFichas, weeklyLinks), /run:.*--resume/);
    assert.match(
      workflow.slice(bootstrapFichas, bootstrapLinks),
      /senate:fichas:full[^\n]*--resume/,
    );
  });

  it("distinguishes unobserved and authoritative-empty Diputados collections", () => {
    assert.deepEqual(buildDiputadosProponentSnapshot({ payload: { list: true } }), {
      observed: false,
      rows: [],
    });
    assert.deepEqual(buildDiputadosProponentSnapshot({ payload: { proponentes: [] } }), {
      observed: true,
      rows: [],
    });
  });

  it("accepts the exact reviewed Santo Domingo profile literal in a 32-profile bijection", async () => {
    const reviewed = REVIEWED_SENADO_SIL_PERSON_BRIDGE.find(
      (row) => row.rosterSourceId === "santo-domingo",
    );
    assert.ok(reviewed);
    assert.equal(reviewed.personSourceId, "3425");
    assert.equal(reviewed.officialName, "Antonio Manuel Tavéras Guzmán");
    assert.equal(reviewed.rosterOfficialName, "Antonio Manuel Taveras Guzman");
    assert.deepEqual(reviewed.profileNameAliases, [
      "Antonio Taveras Guzmán",
      "Antonio Manuel Taveras Guzman",
    ]);
    assert.notEqual(
      senateSilExactNameKey(reviewed.rosterOfficialName),
      senateSilExactNameKey("Antonio Manuel Taveras Guzmán"),
      "the identity gate must not fold accents or accept an unreviewed near-match",
    );
    assert.equal(
      new Set(REVIEWED_SENADO_SIL_PERSON_BRIDGE.map((row) => row.personSourceId)).size,
      32,
    );
    assert.equal(
      new Set(REVIEWED_SENADO_SIL_PERSON_BRIDGE.map((row) => row.rosterSourceId)).size,
      32,
    );
    assert.equal(
      new Set(
        REVIEWED_SENADO_SIL_PERSON_BRIDGE.map((row) =>
          senateSilExactNameKey(row.rosterOfficialName),
        ),
      ).size,
      32,
    );
    assert.equal(CURRENT_SENATE_ROSTER_2026_09_02.length, 32);
    assert.deepEqual(
      REVIEWED_SENADO_SIL_PERSON_BRIDGE.map((row) => ({
        sourceId: row.rosterSourceId,
        fullName: row.rosterOfficialName,
      })).sort((left, right) => left.sourceId.localeCompare(right.sourceId)),
      [...CURRENT_SENATE_ROSTER_2026_09_02].sort((left, right) =>
        left.sourceId.localeCompare(right.sourceId),
      ),
    );

    const handle = createDb();
    try {
      await handle.ensureSchema();
      await replaceRosterSnapshot(
        handle.db,
        "roster-senado",
        CURRENT_SENATE_ROSTER_2026_09_02.map((row) => ({
          source: "roster-senado",
          sourceId: row.sourceId,
          chamber: "SENADO",
          fullName: row.fullName,
        })),
        [],
      );
      const initiative = await upsertInitiative(handle.db, {
        source: "senado-sil",
        sourceId: "sen-santo-domingo-alias-regression",
        kind: "LEGISLATIVE",
        code: "SEN-SANTO-DOMINGO-ALIAS-REGRESSION",
        title: "Iniciativa de prueba del senador de Santo Domingo",
        raw: { payload: { ficha: { proponents: reviewed.officialName } } },
      });
      const summary = await linkInitiativeProponents(handle.db, {
        senateCatalog: parseSenadoSilProponentCatalog(senateCatalogHtml(), {
          observedAt: "2026-09-02T12:00:00.000Z",
        }),
      });

      assert.equal(summary.ok, true);
      assert.equal(summary.senado.replaced, 1);
      const [linked] = await listInitiativeProponents(handle.db, initiative.id);
      assert.equal(linked?.publishedName, "Antonio Manuel Tavéras Guzmán");
      assert.ok(linked?.legislatorId);
      assert.equal(linked?.profile?.fullName, "Antonio Manuel Taveras Guzman");
    } finally {
      await handle.close();
    }
  });

  it("rejects an unreviewed accent-folded Santo Domingo near-match", async () => {
    const handle = createDb();
    try {
      await handle.ensureSchema();
      await replaceRosterSnapshot(
        handle.db,
        "roster-senado",
        CURRENT_SENATE_ROSTER_2026_09_02.map((row) => ({
          source: "roster-senado",
          sourceId: row.sourceId,
          chamber: "SENADO",
          fullName:
            row.sourceId === "santo-domingo" ? "Antonio Manuel Taveras Guzmán" : row.fullName,
        })),
        [],
      );
      const summary = await linkInitiativeProponents(handle.db, {
        senateCatalog: parseSenadoSilProponentCatalog(senateCatalogHtml(), {
          observedAt: "2026-09-02T12:00:00.000Z",
        }),
      });

      assert.equal(summary.ok, false);
      assert.equal(summary.senado.failures, 1);
      assert.match(
        summary.senado.failureExamples[0] ?? "",
        /expected Antonio Manuel Taveras Guzman, observed Antonio Manuel Taveras Guzmán/,
      );
    } finally {
      await handle.close();
    }
  });

  it("is idempotent, preserves failed observations, and namespaces equal chamber ids", async () => {
    const handle = createDb();
    try {
      await handle.ensureSchema();
      await replaceRosterSnapshot(
        handle.db,
        "roster-senado",
        REVIEWED_SENADO_SIL_PERSON_BRIDGE.map((row) => ({
          source: "roster-senado",
          sourceId: row.rosterSourceId,
          chamber: "SENADO",
          fullName: row.rosterOfficialName,
        })),
        [],
      );
      await replaceRosterSnapshot(
        handle.db,
        "roster-diputados",
        [
          {
            source: "roster-diputados",
            sourceId: "3487",
            chamber: "DIPUTADOS",
            fullName: "Diputada con id de otro namespace",
          },
        ],
        [],
      );
      const diputados = await upsertInitiative(handle.db, {
        source: "sil-diputados",
        sourceId: "dip-identity-1",
        kind: "LEGISLATIVE",
        code: "DIP-IDENTITY-1",
        title: "Iniciativa de prueba de Diputados",
        raw: {
          payload: {
            proponentes: [
              {
                legisladorId: 3487,
                nombreCompleto: "Diputada con id de otro namespace",
                principal: true,
              },
            ],
          },
        },
      });
      const senate = await upsertInitiative(handle.db, {
        source: "senado-sil",
        sourceId: "sen-identity-1",
        kind: "LEGISLATIVE",
        code: "SEN-IDENTITY-1",
        title: "Iniciativa de prueba del Senado",
        raw: {
          payload: {
            ficha: { proponents: "Daniel Enrique De Jesús Rivera Reyes" },
          },
        },
      });
      const catalog = parseSenadoSilProponentCatalog(senateCatalogHtml(), {
        observedAt: "2026-08-31T12:00:00.000Z",
      });

      const first = await linkInitiativeProponents(handle.db, {
        senateCatalog: catalog,
        batchSize: 1,
      });
      assert.equal(first.ok, true);
      assert.equal(first.diputados.replaced, 1);
      assert.equal(first.senado.replaced, 1);
      const firstDipRows = await listInitiativeProponents(handle.db, diputados.id);
      const firstSenateRows = await listInitiativeProponents(handle.db, senate.id);
      assert.equal(firstDipRows[0]?.profile?.fullName, "Diputada con id de otro namespace");
      assert.equal(firstSenateRows[0]?.profile?.fullName, "Daniel Enrique De Jesús Rivera Reyes");
      assert.notEqual(firstDipRows[0]?.legislatorId, firstSenateRows[0]?.legislatorId);

      const second = await linkInitiativeProponents(handle.db, {
        senateCatalog: catalog,
        batchSize: 1,
      });
      assert.equal(second.ok, true);
      assert.deepEqual(await listInitiativeProponents(handle.db, diputados.id), firstDipRows);
      assert.deepEqual(await listInitiativeProponents(handle.db, senate.id), firstSenateRows);

      // Historical sponsorship remains exact after a roster turnover marks the
      // profile inactive; reconciliation must not erase a valid official id link.
      await replaceRosterSnapshot(handle.db, "roster-diputados", [], []);
      const afterDiputadosTurnover = await linkInitiativeProponents(handle.db, {
        senateCatalog: catalog,
        batchSize: 1,
      });
      assert.equal(afterDiputadosTurnover.ok, true);
      assert.deepEqual(await listInitiativeProponents(handle.db, diputados.id), firstDipRows);

      // Senate catalog/auth outages are isolated: Diputados still reconciles, the
      // Senate result reports its own failure, and the last Senate snapshot survives.
      const afterSenateOutage = await linkInitiativeProponents(handle.db, {
        senateAdapter: {
          fetchProponentCatalog: async () => {
            throw new Error("simulated Senate selector outage");
          },
        },
        batchSize: 1,
      });
      assert.equal(afterSenateOutage.ok, false);
      assert.equal(afterSenateOutage.diputados.replaced, 1);
      assert.equal(afterSenateOutage.diputados.failures, 0);
      assert.equal(afterSenateOutage.senado.failures, 1);
      assert.match(afterSenateOutage.senado.failureExamples[0]!, /selector outage/);
      assert.deepEqual(await listInitiativeProponents(handle.db, senate.id), firstSenateRows);

      // A list-only Senate refresh is not an observation of `campos_nota_644`; rerunning
      // must leave the last verified relation untouched.
      await upsertInitiative(handle.db, {
        source: "senado-sil",
        sourceId: "sen-identity-1",
        kind: "LEGISLATIVE",
        code: "SEN-IDENTITY-1",
        title: "Iniciativa de prueba del Senado",
        raw: { payload: { list: { idExpediente: "sen-identity-1" } } },
      });
      const afterUnobserved = await linkInitiativeProponents(handle.db, {
        senateCatalog: catalog,
        batchSize: 1,
      });
      assert.equal(afterUnobserved.senado.skippedUnobserved, 1);
      assert.deepEqual(await listInitiativeProponents(handle.db, senate.id), firstSenateRows);

      const incompleteFullCoverage = await linkInitiativeProponents(handle.db, {
        senateCatalog: catalog,
        batchSize: 1,
        recordCoverage: true,
      });
      assert.equal(incompleteFullCoverage.ok, true);
      assert.equal(incompleteFullCoverage.senado.skippedUnobserved, 1);
      assert.equal(incompleteFullCoverage.senado.coverage, "incomplete");
      assert.match(incompleteFullCoverage.senado.coverageReason ?? "", /lacked an observed/);
      assert.equal(incompleteFullCoverage.senado.failures, 0);
      assert.deepEqual(await listInitiativeProponents(handle.db, senate.id), firstSenateRows);

      const dipSnapshot = buildDiputadosProponentSnapshot(
        {
          payload: {
            proponentes: [
              { legisladorId: 3487, nombreCompleto: "Diputada con id de otro namespace" },
            ],
          },
        },
        new Map([["3487", firstDipRows[0]!.legislatorId]]),
      );
      assert.equal(dipSnapshot.rows[0]?.personNamespace, DIPUTADOS_SIL_PERSON_NAMESPACE);
      assert.notEqual(dipSnapshot.rows[0]?.personNamespace, "senado-sil-person");
    } finally {
      await handle.close();
    }
  });
});

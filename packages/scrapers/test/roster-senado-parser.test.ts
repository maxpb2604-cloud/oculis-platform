import { describe, expect, it } from "vitest";
import {
  appendReviewedSenadoProfileAlias,
  matchCardSlug,
  parseProfileIdentityAliases,
  parseSenadoCommissionMemberships,
  parseSenadoRosterCards,
} from "../src/roster-senado.js";

describe("roster-senado: current roster cards", () => {
  it("parses normal and malformed nested Divi headings by unique province URL", () => {
    const html = `
      <div class="et_pb_blurb_0 et_pb_blurb et_pb_module">
        <img alt="Ricardo De Los Santos Polanco" />
        <h4 class="et_pb_module_header"><a href="/provincia/sanchez-ramirez">Ricardo De Los Santos</a></h4>
        <div class="et_pb_blurb_description"><p><strong>PRESIDENTE</strong></p><p>SÁNCHEZ RAMÍREZ</p></div>
      </div>
      <div class="et_pb_blurb_1 et_pb_blurb et_pb_module">
        <img alt="Pedro Manuel Catrain Bonilla" />
        <h4 class="et_pb_module_header"><a href="/provincia/peravia"><h4 class="et_pb_module_header"><a href="https://www.senadord.gob.do/provincia/peravia">Julito Fulcar Encarnación</a></h4></a></h4>
        <div class="et_pb_blurb_description"><p><strong>VICE PRESIDENTE</strong></p><p>PERAVIA</p></div>
      </div>`;

    expect(parseSenadoRosterCards(html)).toEqual([
      {
        slug: "sanchez-ramirez",
        name: "Ricardo De Los Santos",
        role: "Presidente",
        aliases: ["Ricardo De Los Santos", "Ricardo De Los Santos Polanco"],
      },
      {
        slug: "peravia",
        name: "Julito Fulcar Encarnación",
        role: "Vice Presidente",
        aliases: ["Julito Fulcar Encarnación"],
      },
    ]);
  });

  it("deduplicates repeated links and ignores unknown province slugs", () => {
    const html = `
      <div class="et_pb_blurb_0 et_pb_blurb">
        <a href="/provincia/azua">foto</a>
        <h4 class="et_pb_module_header"><a href="/provincia/azua">Lía Ynocencia Díaz Santana</a></h4>
      </div>
      <div class="et_pb_blurb_1 et_pb_blurb">
        <h4 class="et_pb_module_header"><a href="/provincia/no-oficial">Persona Inventada</a></h4>
      </div>`;
    expect(parseSenadoRosterCards(html)).toHaveLength(1);
    expect(parseSenadoRosterCards(html)[0]?.slug).toBe("azua");
  });
});

describe("roster-senado: exact official identity aliases", () => {
  it("adds only the exact profileNameAliases reviewed for the province slug", () => {
    const aliases = appendReviewedSenadoProfileAlias("monsenor-nouel", [
      "Héctor E. Acosta",
      "Héctor Acosta",
    ]);

    expect(aliases).toEqual([
      "Héctor E. Acosta",
      "Héctor Acosta",
      "Hector E. Acosta",
      "Hector Elpidio Acosta Restituyo",
    ]);
    expect(aliases).not.toContain("Héctor Elpidio Acosta Restituyo");
    expect(
      appendReviewedSenadoProfileAlias("maria-trinidad-sanchez", ["Alexis Victoria Yeb"]),
    ).toEqual(["Alexis Victoria Yeb"]);
    expect(appendReviewedSenadoProfileAlias("slug-no-revisado", ["Nombre Publicado"])).toEqual([
      "Nombre Publicado",
    ]);
  });

  it("reads separate exact names from the semantic profile heading and title", () => {
    const html = `
      <html><head><title>Senado | Julito Fulcar Encarnacion - Senador de Peravia 2024-2028</title></head>
      <body><h2>JULITO FULCAR</h2><h5>SENADOR DE LA REPÚBLICA, PROV. PERAVIA</h5>
      <div class="et_pb_image_0 et_pb_image"><span><img title="Julito Fulcar Encarnación" alt="Julito Fulcar Encarnación" /></span></div></body></html>`;
    expect(parseProfileIdentityAliases(html)).toEqual([
      "Julito Fulcar",
      "Julito Fulcar Encarnacion",
    ]);
  });

  it("links only an exact unique published alias and fails closed on ambiguity", () => {
    const unique = [
      {
        slug: "sanchez-ramirez",
        name: "Ricardo De Los Santos",
        role: null,
        aliases: ["Ricardo De Los Santos", "Ricardo De Los Santos Polanco"],
      },
    ];
    expect(matchCardSlug("RICARDO DE LOS SANTOS POLANCO", unique)).toBe("sanchez-ramirez");
    expect(matchCardSlug("RICARDO SANTOS", unique)).toBeNull();

    const ambiguous = [
      ...unique,
      {
        slug: "azua",
        name: "Otra Persona",
        role: null,
        aliases: ["Ricardo De Los Santos Polanco"],
      },
    ];
    expect(matchCardSlug("RICARDO DE LOS SANTOS POLANCO", ambiguous)).toBeNull();
  });
});

describe("roster-senado: commission composition", () => {
  it("parses only numbered rows and separates only explicit cargos", () => {
    const html = `
      <h5 class="et_pb_toggle_title">Administración interior</h5>
      <div class="et_pb_toggle_content">
        <p>Texto explicativo de la comisión.</p>
        <p><strong>1. RICARDO DE LOS SANTOS POLANCO, Presidente</strong><br />
        2. PEDRO MANUEL CATRAIN BONILLA<br />
        3. CRISTÓBAL VENERADO CASTILLO LIRIANO,</p>
      </div>
      <h5 class="et_pb_toggle_title">Salud Pública</h5>
      <div class="et_pb_toggle_content"><p>Sin composición numerada.</p></div>`;

    expect(parseSenadoCommissionMemberships(html, "https://example.test/comisiones")).toEqual([
      expect.objectContaining({
        commissionName: "Administración interior",
        legislatorName: "Ricardo De Los Santos Polanco",
        cargo: "Presidente",
      }),
      expect.objectContaining({
        commissionName: "Administración interior",
        legislatorName: "Pedro Manuel Catrain Bonilla",
        cargo: null,
      }),
      expect.objectContaining({
        commissionName: "Administración interior",
        legislatorName: "Cristóbal Venerado Castillo Liriano",
        cargo: null,
      }),
    ]);
  });
});

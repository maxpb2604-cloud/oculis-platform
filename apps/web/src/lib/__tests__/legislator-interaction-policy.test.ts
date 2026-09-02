import { readdirSync, readFileSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));

interface SourceFile {
  path: string;
  body: string;
}

function productionSources(directory = sourceRoot): SourceFile[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry): SourceFile[] => {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") return [];
      return productionSources(absolute);
    }
    if (!entry.isFile() || ![".ts", ".tsx"].includes(extname(entry.name))) return [];
    if (/\.test\.(?:ts|tsx)$/.test(entry.name)) return [];
    return [
      {
        path: relative(sourceRoot, absolute).replaceAll("\\", "/"),
        body: readFileSync(absolute, "utf8"),
      },
    ];
  });
}

const sources = productionSources();
const byPath = new Map(sources.map((source) => [source.path, source.body]));

function source(path: string): string {
  const body = byPath.get(path);
  if (body == null) throw new Error(`Missing expected source surface: ${path}`);
  return body;
}

const triggerSurfaces = [
  "app/initiatives/[id]/page.tsx",
  "components/initiatives-table.tsx",
  "components/monitoring.tsx",
  "components/feed-card.tsx",
  "components/congress-roster.tsx",
  "components/committee-bubbles.tsx",
  "components/home-province-dashboard.tsx",
  "components/congress-directory-promo.tsx",
  "components/province-bubble-map.tsx",
  "components/feed-rail.tsx",
  "components/feed-social-directory.tsx",
];

const sharedImplementationFiles = new Set([
  "components/legislator-profile-modal.tsx",
  "components/legislator-profile-provider.tsx",
]);

describe("site-wide legislator interaction policy", () => {
  it("forbids direct SIL legislator destinations in customer-facing source", () => {
    const violations = sources
      .filter(({ path }) => !path.startsWith("app/api/legislators/"))
      .filter(({ body }) => /(?:https?:\/\/[^\s"'`]+)?\/sil\/legislador\//i.test(body))
      .map(({ path }) => path);

    expect(violations).toEqual([]);
  });

  it("requires every known person surface to use the shared trigger", () => {
    const violations = triggerSurfaces.filter(
      (path) => !source(path).includes("LegislatorProfileTrigger"),
    );

    expect(violations).toEqual([]);
  });

  it("automatically catches new TSX surfaces that render common legislator-name fields", () => {
    const personField =
      /\b(?:proponent|person|legislator|member|account|row|item|[alm])\.(?:fullName|name|sponsor)\b|\b(?:row|item)\.sponsor\b/;
    const violations = sources
      .filter(({ path }) => path.endsWith(".tsx") && !sharedImplementationFiles.has(path))
      .filter(({ body }) => personField.test(body))
      .filter(({ body }) => !body.includes("LegislatorProfileTrigger"))
      .map(({ path }) => path);

    expect(violations).toEqual([]);
  });

  it("does not allow a person name or legacy profile variable to remain inside an anchor", () => {
    const personInAnchor =
      /\bprofileHref\b|\b(?:proponent|person|legislator|member)\.(?:name|fullName)\b|\b[lm]\.fullName\b|\b(?:row|item)\.sponsor\b/;
    const mixedAccountAndTagFiles = new Set([
      "components/feed-card.tsx",
      "components/feed-rail.tsx",
      "components/feed-social-directory.tsx",
    ]);
    const violations: string[] = [];

    for (const { path, body } of sources) {
      if (
        sharedImplementationFiles.has(path) ||
        path.startsWith("app/api/legislators/") ||
        mixedAccountAndTagFiles.has(path)
      ) {
        continue;
      }
      for (const match of body.matchAll(/<(a|Link)\b[\s\S]*?<\/\1>/g)) {
        if (personInAnchor.test(match[0])) violations.push(path);
      }
    }

    expect([...new Set(violations)]).toEqual([]);
  });

  it("reserves the external official-profile action for the profile bubble", () => {
    const officialActionFiles = sources
      .filter(({ body }) => body.includes('data-action="open-official-legislator-profile"'))
      .map(({ path }) => path);

    expect(officialActionFiles).toEqual(["components/legislator-profile-modal.tsx"]);
    expect(source("components/legislator-profile-modal.tsx")).toContain(
      'data-dialog="legislator-profile"',
    );
    expect(source("components/legislator-profile-modal.tsx")).toContain("safeOfficialUrl");
    expect(source("components/legislator-profile-modal.tsx")).toContain('target="_blank"');
    expect(source("components/legislator-profile-modal.tsx")).toContain(
      'rel="noopener noreferrer"',
    );
  });

  it("marks loading, unavailable, and minimal bubbles with the same dialog contract", () => {
    expect(source("components/legislator-profile-provider.tsx")).toContain(
      'data-dialog="legislator-profile"',
    );
    expect(source("components/legislator-profile-provider.tsx")).toContain('state: "minimal"');
    expect(source("components/legislator-profile-provider.tsx")).toContain(
      "does not try to identify the person by name",
    );
  });

  it("keeps trigger and dialog ownership in the persistent application shell", () => {
    const frame = source("components/app-shell-frame.tsx");
    const provider = source("components/legislator-profile-provider.tsx");

    expect(frame).toContain("LegislatorProfileProvider");
    expect(provider).toContain('data-entity="legislator"');
    expect(provider).toContain("data-legislator-key=");
    expect(provider).toContain('aria-haspopup="dialog"');
    expect(provider).toContain("/api/legislators/${profileId}");
    expect(provider).not.toMatch(/window\.(?:location|open)|location\.(?:assign|replace)/);
  });

  it("keeps mixed feed/account surfaces explicit about the legislator branch", () => {
    for (const path of [
      "components/feed-card.tsx",
      "components/feed-rail.tsx",
      "components/feed-social-directory.tsx",
    ]) {
      const body = source(path);
      expect(body).toContain("LegislatorProfileTrigger");
    }

    const feedCard = source("components/feed-card.tsx");
    expect(feedCard).toContain('tag.entityType === "LEGISLATOR"');
    expect(feedCard).not.toMatch(
      /else if\s*\(tag\.entityType === "LEGISLATOR"[\s\S]{0,180}p\.set\("legislatorSourceId"/,
    );

    for (const path of ["components/feed-rail.tsx", "components/feed-social-directory.tsx"]) {
      const body = source(path);
      expect(body).toContain("SENATOR");
      expect(body).toContain("DEPUTY");
      expect(body).toContain("legislatorProfileId");
    }
  });
});

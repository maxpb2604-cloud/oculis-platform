/**
 * Minimal .env loader (no dependency). Loads the monorepo-root .env so the worker
 * picks up ANTHROPIC_API_KEY / OCULIS_* / DATABASE_URL without exporting them in the shell.
 * Existing process.env values win (so CLI/env overrides still work).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadEnv(): void {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"), // when cwd is apps/worker
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    for (const raw of readFileSync(path, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
    return; // first found wins
  }
}

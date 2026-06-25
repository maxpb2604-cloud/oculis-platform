import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Vitest config for the web app. Tests here are pure-logic (no DB/network), so the
// default `node` environment is sufficient. The `@/` alias mirrors the tsconfig
// `paths` mapping (`@/* -> ./src/*`) so tests import modules exactly as app code does.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "src/**/__tests__/**/*.{ts,tsx}"],
  },
});

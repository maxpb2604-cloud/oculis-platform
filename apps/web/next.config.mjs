/** @type {import('next').NextConfig} */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const configDir = dirname(fileURLToPath(import.meta.url));

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https: ws: wss:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");

// The document guard returns a self-contained recovery page rather than the Next
// application shell. Keep that page scriptless at the actual HTTP boundary; the
// catch-all policy below would otherwise overwrite the stricter route response.
const officialDocumentRecoveryPolicy = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "script-src 'none'",
  "style-src 'sha256-Mi3bnDKLZiTcS322lbsfUIWCEMyvZYGqJjjOqC3gT1s='",
].join("; ");

const nextConfig = {
  distDir: process.env.OCULIS_NEXT_DIST_DIR || ".next",
  output: "standalone",
  outputFileTracingRoot: join(configDir, "../.."),
  transpilePackages: ["@oculis/db", "@oculis/core", "@oculis/scrapers"],
  poweredByHeader: false,
  reactStrictMode: true,
  // CI runs the monorepo ESLint config explicitly before build.
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
        ],
      },
      {
        source: "/api/document/open",
        headers: [
          { key: "Content-Security-Policy", value: officialDocumentRecoveryPolicy },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      { source: "/legislative", destination: "/", permanent: true },
      { source: "/regulatory", destination: "/regulatorio", permanent: true },
    ];
  },
  // Keep native/WASM DB drivers out of the bundler; load them at runtime in Node.
  serverExternalPackages: ["@electric-sql/pglite", "pg", "drizzle-orm"],
  webpack(config) {
    // Workspace packages use ESM ".js" specifiers that point at ".ts" sources.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};
export default nextConfig;

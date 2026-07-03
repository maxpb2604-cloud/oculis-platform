/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@oculis/db", "@oculis/core"],
  // Keep native/WASM DB drivers out of the bundler; load them at runtime in Node.
  serverExternalPackages: ["@electric-sql/pglite", "pg", "drizzle-orm"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
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

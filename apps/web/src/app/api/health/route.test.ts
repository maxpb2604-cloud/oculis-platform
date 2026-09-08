import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/health", () => {
  const originalRenderGitCommit = process.env.RENDER_GIT_COMMIT;
  const originalGitHubSha = process.env.GITHUB_SHA;

  beforeEach(() => {
    delete process.env.RENDER_GIT_COMMIT;
    delete process.env.GITHUB_SHA;
  });

  afterEach(() => {
    if (originalRenderGitCommit === undefined) delete process.env.RENDER_GIT_COMMIT;
    else process.env.RENDER_GIT_COMMIT = originalRenderGitCommit;

    if (originalGitHubSha === undefined) delete process.env.GITHUB_SHA;
    else process.env.GITHUB_SHA = originalGitHubSha;
  });

  it("reports process liveness without requiring the database", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "oculis-web",
    });
  });

  it("identifies the exact Render release when the platform provides its commit SHA", async () => {
    process.env.RENDER_GIT_COMMIT = "ac49d6664280ba7bb4e75de33e22c14deb97ddbf";

    const response = await GET();

    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "oculis-web",
      release: "ac49d6664280ba7bb4e75de33e22c14deb97ddbf",
    });
  });
});

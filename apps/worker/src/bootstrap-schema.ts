/** Explicit one-time schema bootstrap for a worker workflow or deployment. */
import { createDb } from "@oculis/db";
import { loadEnv } from "./env.js";
import { prepareWorkerSchema } from "./schema-bootstrap.js";

loadEnv();

async function main(): Promise<void> {
  const handle = createDb();
  try {
    console.log("▶ Oculis database preflight and schema bootstrap");
    await prepareWorkerSchema(handle, { force: true });
    console.log("✔ database reachable and schema ready");
  } finally {
    await handle.close();
  }
}

main().catch((error) => {
  // Print the complete error so provider details such as a nested SQLSTATE/cause
  // remain visible in the workflow log and alert.
  console.error("✖ database preflight/schema bootstrap failed:", error);
  process.exitCode = 1;
});

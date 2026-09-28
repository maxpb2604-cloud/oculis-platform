import type { DbHandle } from "@oculis/db";

export interface WorkerSchemaBootstrapOptions {
  /**
   * Force the explicit bootstrap command to run even when ordinary worker
   * processes have automatic DDL disabled.
   */
  force?: boolean;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
}

/**
 * Prepare the worker database without making every cloud lane replay the full
 * idempotent DDL catalog. Local development and tests keep their historical
 * bootstrap-by-default behavior; production can set OCULIS_AUTO_MIGRATE=0 after
 * running one explicit schema bootstrap for the workflow.
 */
export async function prepareWorkerSchema(
  handle: Pick<DbHandle, "ensureSchema">,
  options: WorkerSchemaBootstrapOptions = {},
): Promise<"applied" | "skipped"> {
  const env = options.env ?? process.env;
  if (!options.force && env.OCULIS_AUTO_MIGRATE === "0") {
    options.log?.("  schema bootstrap skipped (OCULIS_AUTO_MIGRATE=0)");
    return "skipped";
  }

  await handle.ensureSchema();
  return "applied";
}

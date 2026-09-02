/** Daily maintenance entrypoint for changed congressional histories in both chambers. */
import { createDb } from "@oculis/db";
import { loadEnv } from "./env.js";
import {
  assertIncrementalMovementsComplete,
  ingestIncrementalMovements,
} from "./ingest-incremental-movements.js";
import { assertSourcesOk } from "./reliability.js";

loadEnv();

async function main(): Promise<void> {
  const { db, ensureSchema, close } = createDb();
  const started = Date.now();
  try {
    await ensureSchema();
    const summary = await ingestIncrementalMovements(db, {
      log: (message) => console.log(message),
    });
    const seconds = ((Date.now() - started) / 1_000).toFixed(1);
    console.log(
      `\n${summary.ok ? "✔" : "⚠"} incremental movements ${summary.runDate} in ${seconds}s — ` +
        `Cámara ${summary.diputados.checked}/${summary.diputados.changed} historiales, ` +
        `Senado ${summary.senado.checked}/${summary.senado.changed} Fichas, ` +
        `${summary.diputados.statusEventsInserted + summary.senado.statusEventsInserted} eventos nuevos, ` +
        `${summary.diputados.statusEventsRetired + summary.senado.statusEventsRetired} retirados, ` +
        `${summary.diputados.statusEventsReactivated + summary.senado.statusEventsReactivated} reactivados`,
    );
    assertSourcesOk("incremental congressional movements", [summary.diputados, summary.senado]);
    assertIncrementalMovementsComplete(summary);
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error("✖", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

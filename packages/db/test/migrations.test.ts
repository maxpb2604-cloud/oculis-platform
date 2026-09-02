import { PGlite } from "@electric-sql/pglite";
import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

async function applyMigrations(
  client: PGlite,
  migrations: MigrationMeta[],
  from: number,
  through: number,
): Promise<void> {
  for (const migration of migrations.slice(from, through + 1)) {
    for (const statement of migration.sql) await client.exec(statement);
  }
}

describe("migration chain", () => {
  it(
    "preserves reviewed document summaries when 0018 retires the feature",
    { timeout: 30_000 },
    async () => {
      const migrations = readMigrationFiles({ migrationsFolder });
      expect(migrations.length).toBeGreaterThanOrEqual(23);
      const client = new PGlite();
      try {
        await applyMigrations(client, migrations, 0, 17);
        const document = await client.query<{ id: number }>(`
          INSERT INTO documents (source, source_doc_id, url)
          VALUES ('migration-audit', 'reviewed-summary', 'https://example.com/reviewed.pdf')
          RETURNING id
        `);
        const sourceSnapshot = {
          initiativeId: null,
          source: "migration-audit",
          sourceDocId: "reviewed-summary",
          url: "https://example.com/reviewed.pdf",
          docType: "PROYECTO DEPOSITADO",
          uploadedAt: "2026-08-31",
          modifiedAt: null,
        };
        const content = await client.query<{ id: number }>(
          `
            INSERT INTO document_contents (
              document_id, content_hash, source_snapshot, content_text, mime_type,
              byte_size, page_count, character_count, extracted_at, last_verified_at
            )
            VALUES ($1, $2, $3::jsonb, 'archived official text', 'application/pdf',
              128, 1, 22, '2026-08-31T12:00:00Z', '2026-08-31T12:00:00Z')
            RETURNING id
          `,
          [document.rows[0]!.id, "a".repeat(64), JSON.stringify(sourceSnapshot)],
        );
        await client.query(
          `
            INSERT INTO document_summaries (
              document_content_id, content_hash, model, prompt_version, prompt_hash,
              summary, attempt, reviewed_at, reviewed_by
            )
            VALUES ($1, $2, 'audit-model', 'v1', $3,
              'Human-reviewed summary that must survive migration.', 1,
              '2026-09-01T09:30:00Z', 'release-reviewer')
          `,
          [content.rows[0]!.id, "a".repeat(64), "b".repeat(64)],
        );
        const before = await client.query<Record<string, unknown>>(
          "SELECT * FROM document_summaries ORDER BY id",
        );

        await applyMigrations(client, migrations, 18, 18);

        const relations = await client.query<{
          active_table: string | null;
          archive_table: string | null;
        }>(`
          SELECT
            to_regclass('public.document_summaries')::text AS active_table,
            to_regclass('public.retired_document_summaries')::text AS archive_table
        `);
        expect(relations.rows[0]).toEqual({
          active_table: null,
          archive_table: "retired_document_summaries",
        });
        expect(
          (
            await client.query<Record<string, unknown>>(
              "SELECT * FROM retired_document_summaries ORDER BY id",
            )
          ).rows,
        ).toEqual(before.rows);

        await applyMigrations(client, migrations, 19, migrations.length - 1);
        expect(
          (
            await client.query<Record<string, unknown>>(
              "SELECT * FROM retired_document_summaries ORDER BY id",
            )
          ).rows,
        ).toEqual(before.rows);
      } finally {
        await client.close();
      }
    },
  );
});

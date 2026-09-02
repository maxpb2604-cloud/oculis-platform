-- The summary feature is retired from the application schema, but its historical and
-- human-review evidence is an audit record. Keep it as an unmanaged archive instead of
-- destroying it during the upgrade.
ALTER TABLE "document_summaries" RENAME TO "retired_document_summaries";
--> statement-breakpoint
COMMENT ON TABLE "retired_document_summaries" IS
  'Retired Oculis document-summary audit archive; preserved verbatim and not served by the application';

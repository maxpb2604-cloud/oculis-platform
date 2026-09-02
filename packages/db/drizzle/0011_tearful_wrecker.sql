ALTER TABLE "document_contents" ADD COLUMN "source_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "document_contents" ADD COLUMN "last_verified_at" timestamp;--> statement-breakpoint
-- No historical extraction-time snapshot exists for pre-0011 rows. Preserve the
-- complete current official-document association once, without inventing values.
UPDATE "document_contents" AS "dc"
SET "source_snapshot" = jsonb_build_object(
	'initiativeId', "d"."initiative_id",
	'source', "d"."source",
	'sourceDocId', "d"."source_doc_id",
	'url', "d"."url",
	'docType', "d"."doc_type",
	'uploadedAt', "d"."uploaded_at",
	'modifiedAt', "d"."modified_at"
)
FROM "documents" AS "d"
WHERE "dc"."document_id" = "d"."id"
	AND "dc"."source_snapshot" IS NULL;--> statement-breakpoint
-- Extraction necessarily verified the fetched document at extracted_at. Reuse that
-- historical fact instead of making legacy rows appear freshly verified by migration.
UPDATE "document_contents"
SET "last_verified_at" = "extracted_at"
WHERE "last_verified_at" IS NULL;--> statement-breakpoint
ALTER TABLE "document_contents" ALTER COLUMN "last_verified_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "document_contents" ALTER COLUMN "last_verified_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "document_contents" ALTER COLUMN "source_snapshot" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "document_contents" ADD CONSTRAINT "document_contents_source_snapshot_object_check" CHECK (jsonb_typeof("document_contents"."source_snapshot") = 'object'
          and "document_contents"."source_snapshot" ?& array[
            'initiativeId', 'source', 'sourceDocId', 'url', 'docType', 'uploadedAt', 'modifiedAt'
          ]
          and jsonb_typeof("document_contents"."source_snapshot" -> 'initiativeId') in ('number', 'null')
          and jsonb_typeof("document_contents"."source_snapshot" -> 'source') = 'string'
          and jsonb_typeof("document_contents"."source_snapshot" -> 'sourceDocId') in ('string', 'null')
          and jsonb_typeof("document_contents"."source_snapshot" -> 'url') in ('string', 'null')
          and jsonb_typeof("document_contents"."source_snapshot" -> 'docType') in ('string', 'null')
          and jsonb_typeof("document_contents"."source_snapshot" -> 'uploadedAt') in ('string', 'null')
          and jsonb_typeof("document_contents"."source_snapshot" -> 'modifiedAt') in ('string', 'null'));--> statement-breakpoint
CREATE UNIQUE INDEX "document_contents_document_hash_snapshot_uq" ON "document_contents" USING btree ("document_id","content_hash",md5("source_snapshot"::text));--> statement-breakpoint
DROP INDEX "document_contents_document_hash_uq";

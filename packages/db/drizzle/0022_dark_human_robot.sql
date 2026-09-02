CREATE TABLE "document_pdf_verifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"source_snapshot" jsonb NOT NULL,
	"reachable" boolean NOT NULL,
	"http_status" integer,
	"mime_type" text,
	"byte_size" integer,
	"final_url" text,
	"error_code" text,
	"error_message" text,
	"verified_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "document_pdf_verifications_source_snapshot_object_check" CHECK (jsonb_typeof("document_pdf_verifications"."source_snapshot") = 'object'
          and "document_pdf_verifications"."source_snapshot" ?& array[
            'initiativeId', 'source', 'sourceDocId', 'url', 'docType', 'uploadedAt', 'modifiedAt'
          ]
          and jsonb_typeof("document_pdf_verifications"."source_snapshot" -> 'initiativeId') in ('number', 'null')
          and jsonb_typeof("document_pdf_verifications"."source_snapshot" -> 'source') = 'string'
          and jsonb_typeof("document_pdf_verifications"."source_snapshot" -> 'sourceDocId') in ('string', 'null')
          and jsonb_typeof("document_pdf_verifications"."source_snapshot" -> 'url') in ('string', 'null')
          and jsonb_typeof("document_pdf_verifications"."source_snapshot" -> 'docType') in ('string', 'null')
          and jsonb_typeof("document_pdf_verifications"."source_snapshot" -> 'uploadedAt') in ('string', 'null')
          and jsonb_typeof("document_pdf_verifications"."source_snapshot" -> 'modifiedAt') in ('string', 'null')),
	CONSTRAINT "document_pdf_verifications_outcome_check" CHECK ((
            "document_pdf_verifications"."reachable" = true
            and "document_pdf_verifications"."http_status" in (200, 206)
            and "document_pdf_verifications"."mime_type" in ('application/pdf', 'application/octet-stream')
            and ("document_pdf_verifications"."byte_size" is null or "document_pdf_verifications"."byte_size" > 0)
            and length(trim("document_pdf_verifications"."final_url")) > 0
            and "document_pdf_verifications"."error_code" is null
            and "document_pdf_verifications"."error_message" is null
          ) or (
            "document_pdf_verifications"."reachable" = false
            and "document_pdf_verifications"."http_status" is null
            and "document_pdf_verifications"."mime_type" is null
            and "document_pdf_verifications"."byte_size" is null
            and "document_pdf_verifications"."final_url" is null
            and length(trim("document_pdf_verifications"."error_code")) > 0
            and length(trim("document_pdf_verifications"."error_message")) > 0
          ))
);
--> statement-breakpoint
ALTER TABLE "document_pdf_verifications" ADD CONSTRAINT "document_pdf_verifications_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_pdf_verifications_document_snapshot_uq" ON "document_pdf_verifications" USING btree ("document_id",md5("source_snapshot"::text));--> statement-breakpoint
CREATE INDEX "document_pdf_verifications_document_verified_idx" ON "document_pdf_verifications" USING btree ("document_id","verified_at" DESC NULLS LAST);--> statement-breakpoint
DELETE FROM "document_pdf_verifications"
WHERE "reachable" = false
	AND (
		"error_code" = 'PDF_FETCH_FAILED'
		OR (
			"error_code" = 'PDF_HTTP_ERROR'
			AND "error_message" ~ 'HTTP (408|425|429|5[0-9][0-9])'
		)
	);--> statement-breakpoint
INSERT INTO "document_pdf_verifications" (
	"document_id", "source_snapshot", "reachable", "http_status", "mime_type", "byte_size",
	"final_url", "error_code", "error_message", "verified_at"
)
SELECT DISTINCT ON (dc."document_id", md5(dc."source_snapshot"::text))
	dc."document_id",
	dc."source_snapshot",
	true,
	200,
	'application/pdf',
	dc."byte_size",
	dc."source_snapshot" ->> 'url',
	NULL,
	NULL,
	dc."last_verified_at"
FROM "document_contents" dc
WHERE dc."byte_size" > 0
	AND length(trim(dc."source_snapshot" ->> 'url')) > 0
ORDER BY dc."document_id", md5(dc."source_snapshot"::text), dc."last_verified_at" DESC
ON CONFLICT DO NOTHING;

CREATE TABLE "document_contents" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"content_hash" text NOT NULL,
	"content_text" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"page_count" integer NOT NULL,
	"character_count" integer NOT NULL,
	"extracted_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "document_contents_valid_sizes_check" CHECK ("document_contents"."byte_size" > 0 and "document_contents"."page_count" > 0 and "document_contents"."character_count" > 0),
	CONSTRAINT "document_contents_sha256_check" CHECK ("document_contents"."content_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "document_summaries" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_content_id" integer NOT NULL,
	"content_hash" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "document_summaries_nonempty_check" CHECK (length(trim("document_summaries"."summary")) > 0),
	CONSTRAINT "document_summaries_sha256_check" CHECK ("document_summaries"."content_hash" ~ '^[a-f0-9]{64}$' and "document_summaries"."prompt_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "initiative_commission_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"initiative_id" integer NOT NULL,
	"source" text NOT NULL,
	"source_assignment_id" text,
	"source_type_id" text,
	"name" text,
	"type" text,
	"start_date" text,
	"end_date" text,
	"raw" jsonb,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "status_events_source_dated_uq";--> statement-breakpoint
DROP INDEX "status_events_source_undated_uq";--> statement-breakpoint
ALTER TABLE "initiatives" ADD COLUMN "source_chamber" text;--> statement-breakpoint
ALTER TABLE "initiatives" ADD COLUMN "origin_chamber" text;--> statement-breakpoint
ALTER TABLE "initiatives" ADD COLUMN "current_chamber" text;--> statement-breakpoint
ALTER TABLE "initiatives" ADD COLUMN "current_body" text;--> statement-breakpoint
ALTER TABLE "initiatives" ADD COLUMN "condition" text;--> statement-breakpoint
ALTER TABLE "initiatives" ADD COLUMN "subject_matter" text;--> statement-breakpoint
ALTER TABLE "initiatives" ADD COLUMN "initiated" text;--> statement-breakpoint
ALTER TABLE "initiatives" ADD COLUMN "initiated_at" text;--> statement-breakpoint
ALTER TABLE "initiatives" ADD COLUMN "legislature" text;--> statement-breakpoint
ALTER TABLE "initiatives" ADD COLUMN "registration_period" text;--> statement-breakpoint
ALTER TABLE "initiatives" ADD COLUMN "official_status_changed_at" text;--> statement-breakpoint
ALTER TABLE "initiatives" ADD COLUMN "promulgation_number" text;--> statement-breakpoint
ALTER TABLE "initiatives" ADD COLUMN "promulgated_at" text;--> statement-breakpoint
ALTER TABLE "status_events" ADD COLUMN "event_end_date" text;--> statement-breakpoint
ALTER TABLE "status_events" ADD COLUMN "source_event_id" text;--> statement-breakpoint
-- Backfill only source history rows whose official Diputados history id is
-- non-empty and unambiguous inside the initiative/source/evidence namespace.
-- Ambiguous legacy rows remain on the complete-payload fallback identity below.
UPDATE "status_events" AS "candidate"
SET "source_event_id" = nullif(btrim("candidate"."raw" ->> 'id'), '')
WHERE "candidate"."source_event_id" IS NULL
	AND "candidate"."source" = 'sil-diputados'
	AND "candidate"."evidence_type" = 'SOURCE_HISTORY'
	AND jsonb_typeof("candidate"."raw") = 'object'
	AND nullif(btrim("candidate"."raw" ->> 'id'), '') IS NOT NULL
	AND NOT EXISTS (
		SELECT 1
		FROM "status_events" AS "duplicate"
		WHERE "duplicate"."id" <> "candidate"."id"
			AND "duplicate"."initiative_id" = "candidate"."initiative_id"
			AND "duplicate"."source" = "candidate"."source"
			AND "duplicate"."evidence_type" = "candidate"."evidence_type"
			AND (
				"duplicate"."source_event_id" = nullif(btrim("candidate"."raw" ->> 'id'), '')
				OR nullif(btrim("duplicate"."raw" ->> 'id'), '') = nullif(btrim("candidate"."raw" ->> 'id'), '')
			)
	);--> statement-breakpoint
-- Preserve the official `fin` date only when its leading value round-trips as
-- a strict ISO calendar date. Malformed or impossible values stay in raw.
UPDATE "status_events"
SET "event_end_date" = substring("raw" ->> 'fin' from 1 for 10)
WHERE "event_end_date" IS NULL
	AND "source" = 'sil-diputados'
	AND "evidence_type" = 'SOURCE_HISTORY'
	AND jsonb_typeof("raw") = 'object'
	AND ("raw" ->> 'fin') ~ '^\d{4}-\d{2}-\d{2}(?:$|[T ])'
	AND CASE
		WHEN substring("raw" ->> 'fin' from 1 for 10)
			~ '^[12][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
			THEN to_char(
				make_date(
					substring("raw" ->> 'fin' from 1 for 4)::int,
					substring("raw" ->> 'fin' from 6 for 2)::int,
					1
				) + (substring("raw" ->> 'fin' from 9 for 2)::int - 1),
				'YYYY-MM-DD'
			) = substring("raw" ->> 'fin' from 1 for 10)
		ELSE false
	END;--> statement-breakpoint
ALTER TABLE "document_contents" ADD CONSTRAINT "document_contents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_summaries" ADD CONSTRAINT "document_summaries_document_content_id_document_contents_id_fk" FOREIGN KEY ("document_content_id") REFERENCES "public"."document_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_commission_assignments" ADD CONSTRAINT "initiative_commission_assignments_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_contents_document_hash_uq" ON "document_contents" USING btree ("document_id","content_hash");--> statement-breakpoint
CREATE INDEX "document_contents_hash_idx" ON "document_contents" USING btree ("content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "document_summaries_content_hash_model_prompt_uq" ON "document_summaries" USING btree ("document_content_id","content_hash","model","prompt_hash");--> statement-breakpoint
CREATE INDEX "document_summaries_content_idx" ON "document_summaries" USING btree ("document_content_id");--> statement-breakpoint
CREATE UNIQUE INDEX "initiative_commission_assignments_source_id_uq" ON "initiative_commission_assignments" USING btree ("initiative_id","source","source_assignment_id") WHERE "initiative_commission_assignments"."source_assignment_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "initiative_commission_assignments_fallback_uq" ON "initiative_commission_assignments" USING btree ("initiative_id","source",coalesce("source_type_id", ''),coalesce("name", ''),coalesce("type", ''),coalesce("start_date", ''),coalesce("end_date", ''),md5(coalesce("raw"::text, ''))) WHERE "initiative_commission_assignments"."source_assignment_id" is null;--> statement-breakpoint
CREATE INDEX "initiative_commission_assignments_initiative_idx" ON "initiative_commission_assignments" USING btree ("initiative_id");--> statement-breakpoint
CREATE UNIQUE INDEX "status_events_source_id_uq" ON "status_events" USING btree ("initiative_id","evidence_type","source","source_event_id") WHERE "status_events"."evidence_type" = 'SOURCE_HISTORY' and "status_events"."source_event_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "status_events_source_fallback_uq" ON "status_events" USING btree ("initiative_id","status",coalesce("event_date", ''),coalesce("event_end_date", ''),coalesce("note", ''),"evidence_type","source",coalesce("source_url", ''),md5(coalesce("raw"::text, ''))) WHERE "status_events"."evidence_type" = 'SOURCE_HISTORY' and "status_events"."source_event_id" is null;

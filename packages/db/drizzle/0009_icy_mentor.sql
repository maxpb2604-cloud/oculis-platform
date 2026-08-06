DROP INDEX "status_events_source_dated_uq";--> statement-breakpoint
DROP INDEX "status_events_source_undated_uq";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "modified_at" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "source_category" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "source_fragment" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "raw" jsonb;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "last_seen_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "status_events_source_dated_uq" ON "status_events" USING btree ("initiative_id","status","event_date","evidence_type","source",coalesce("source_url", '')) WHERE "status_events"."evidence_type" = 'SOURCE_HISTORY' and "status_events"."event_date" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "status_events_source_undated_uq" ON "status_events" USING btree ("initiative_id","status","evidence_type","source",coalesce("source_url", '')) WHERE "status_events"."evidence_type" = 'SOURCE_HISTORY' and "status_events"."event_date" is null;
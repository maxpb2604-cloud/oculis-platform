DROP INDEX "status_events_source_id_uq";--> statement-breakpoint
DROP INDEX "status_events_source_fallback_uq";--> statement-breakpoint
ALTER TABLE "status_events" ADD COLUMN "last_seen_at" timestamp;--> statement-breakpoint
ALTER TABLE "status_events" ADD COLUMN "retired_at" timestamp;--> statement-breakpoint
UPDATE "status_events"
   SET "last_seen_at" = coalesce("observed_at", "created_at", now())
 WHERE "last_seen_at" IS NULL;--> statement-breakpoint
ALTER TABLE "status_events" ALTER COLUMN "last_seen_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "status_events" ALTER COLUMN "last_seen_at" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "status_events_source_version_uq" ON "status_events" USING btree ("initiative_id","evidence_type","source",coalesce("source_event_id", ''),"status",coalesce("event_date", ''),coalesce("event_end_date", ''),coalesce("note", ''),coalesce("source_url", ''),md5(coalesce("raw"::text, ''))) WHERE "status_events"."evidence_type" = 'SOURCE_HISTORY';

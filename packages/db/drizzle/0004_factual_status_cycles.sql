DROP INDEX "status_events_evidence_uq";--> statement-breakpoint
DROP INDEX "status_events_evidence_null_date_uq";--> statement-breakpoint
ALTER TABLE "regulations" ADD COLUMN "source_category" text;--> statement-breakpoint
CREATE INDEX "regulations_source_category_idx" ON "regulations" USING btree ("source_category");--> statement-breakpoint
CREATE UNIQUE INDEX "status_events_source_dated_uq" ON "status_events" USING btree ("initiative_id","status","event_date","evidence_type") WHERE "status_events"."evidence_type" = 'SOURCE_HISTORY' and "status_events"."event_date" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "status_events_source_undated_uq" ON "status_events" USING btree ("initiative_id","status","evidence_type") WHERE "status_events"."evidence_type" = 'SOURCE_HISTORY' and "status_events"."event_date" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "status_events_observed_uq" ON "status_events" USING btree ("initiative_id","status","observed_at","evidence_type") WHERE "status_events"."evidence_type" = 'OBSERVED_CHANGE';
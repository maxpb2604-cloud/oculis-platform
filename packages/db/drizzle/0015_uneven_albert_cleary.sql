ALTER TABLE "activity_events" ADD COLUMN "source_event_id" text;--> statement-breakpoint
ALTER TABLE "activity_events" ADD COLUMN "location" text;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_events_source_event_uq" ON "activity_events" USING btree ("source","source_event_id") WHERE "activity_events"."source_event_id" is not null;--> statement-breakpoint
UPDATE "activity_events"
SET "agenda_url" = NULL
WHERE ("source" = 'sil-actividad' AND "agenda_url" ~ '^https://www\\.diputadosrd\\.gob\\.do/sil/comision/[0-9]+/?$')
   OR ("source" = 'senado' AND "agenda_url" ~ '^https://www\\.senadord\\.gob\\.do/wpfd_file/');

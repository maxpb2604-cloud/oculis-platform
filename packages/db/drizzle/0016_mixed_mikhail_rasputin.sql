CREATE TABLE "initiative_title_translations" (
	"id" serial PRIMARY KEY NOT NULL,
	"initiative_id" integer NOT NULL,
	"target_locale" text NOT NULL,
	"source_title" text NOT NULL,
	"source_title_hash" text NOT NULL,
	"translated_title" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "initiative_title_translations_nonempty_check" CHECK (length(trim("initiative_title_translations"."source_title")) > 0
          and length(trim("initiative_title_translations"."translated_title")) > 0
          and length(trim("initiative_title_translations"."model")) > 0),
	CONSTRAINT "initiative_title_translations_sha256_check" CHECK ("initiative_title_translations"."source_title_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "initiative_title_translations_locale_check" CHECK ("initiative_title_translations"."target_locale" = 'en')
);
--> statement-breakpoint
ALTER TABLE "initiative_title_translations" ADD CONSTRAINT "initiative_title_translations_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "initiative_title_translations_source_model_uq" ON "initiative_title_translations" USING btree ("initiative_id","target_locale","source_title_hash","model");--> statement-breakpoint
CREATE INDEX "initiative_title_translations_current_idx" ON "initiative_title_translations" USING btree ("initiative_id","target_locale","source_title","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "initiative_title_translations_candidate_idx" ON "initiative_title_translations" USING btree ("initiative_id","target_locale","model","source_title");
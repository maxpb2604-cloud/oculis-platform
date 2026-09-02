CREATE TABLE "initiative_proponents" (
	"id" serial PRIMARY KEY NOT NULL,
	"initiative_id" integer NOT NULL,
	"legislator_id" integer,
	"initiative_source" text NOT NULL,
	"person_namespace" text NOT NULL,
	"person_source_id" text,
	"published_name" text NOT NULL,
	"principal" boolean,
	"ordinal" integer NOT NULL,
	"match_basis" text NOT NULL,
	"evidence" jsonb,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "initiative_proponents_ordinal_check" CHECK ("initiative_proponents"."ordinal" >= 0),
	CONSTRAINT "initiative_proponents_match_basis_check" CHECK ("initiative_proponents"."match_basis" in ('official-id', 'official-selector-exact-name', 'unresolved')),
	CONSTRAINT "initiative_proponents_nonempty_check" CHECK (length(trim("initiative_proponents"."initiative_source")) > 0
          and length(trim("initiative_proponents"."person_namespace")) > 0
          and length(trim("initiative_proponents"."published_name")) > 0
          and ("initiative_proponents"."person_source_id" is null or length(trim("initiative_proponents"."person_source_id")) > 0)),
	CONSTRAINT "initiative_proponents_resolution_check" CHECK (("initiative_proponents"."match_basis" = 'unresolved' and "initiative_proponents"."legislator_id" is null)
          or ("initiative_proponents"."match_basis" <> 'unresolved' and "initiative_proponents"."legislator_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "initiative_proponents" ADD CONSTRAINT "initiative_proponents_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_proponents" ADD CONSTRAINT "initiative_proponents_legislator_id_legislators_id_fk" FOREIGN KEY ("legislator_id") REFERENCES "public"."legislators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "initiative_proponents_snapshot_ordinal_uq" ON "initiative_proponents" USING btree ("initiative_id","initiative_source","ordinal");--> statement-breakpoint
CREATE INDEX "initiative_proponents_legislator_idx" ON "initiative_proponents" USING btree ("legislator_id");--> statement-breakpoint
CREATE INDEX "initiative_proponents_initiative_idx" ON "initiative_proponents" USING btree ("initiative_id");

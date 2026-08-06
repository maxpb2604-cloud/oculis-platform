CREATE TABLE "activity_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"scope" text NOT NULL,
	"chamber" text,
	"event_date" text,
	"kind" text,
	"body" text,
	"description" text NOT NULL,
	"agenda_url" text,
	"statuses" jsonb,
	"dedupe_key" text NOT NULL,
	"raw" jsonb,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_initiatives" (
	"id" serial PRIMARY KEY NOT NULL,
	"activity_id" integer NOT NULL,
	"initiative_code" text NOT NULL,
	"initiative_id" integer
);
--> statement-breakpoint
CREATE TABLE "commission_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"chamber" text NOT NULL,
	"commission_name" text NOT NULL,
	"commission_source_id" text,
	"legislator_name" text NOT NULL,
	"legislator_source_id" text,
	"cargo" text,
	"party" text,
	"source_url" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"chamber" text NOT NULL,
	"name" text NOT NULL,
	"president" text,
	"source_id" text,
	"source_url" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"initiative_id" integer,
	"initiative_code" text,
	"doc_type" text,
	"extension" text,
	"url" text,
	"uploaded_at" text,
	"source_doc_id" text,
	"first_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"handle" text NOT NULL,
	"platform" text NOT NULL,
	"url" text NOT NULL,
	"kind" text NOT NULL,
	"chamber" text,
	"legislator_source_id" text,
	"influence_rank" integer,
	"active" boolean DEFAULT true NOT NULL,
	"raw" jsonb,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_item_entities" (
	"id" serial PRIMARY KEY NOT NULL,
	"feed_item_id" integer NOT NULL,
	"entity_type" text NOT NULL,
	"initiative_code" text,
	"initiative_id" integer,
	"legislator_source_id" text,
	"commission_name" text,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"image_url" text,
	"url" text,
	"author" text,
	"handle" text,
	"platform" text,
	"category" text,
	"published_at" timestamp,
	"initiative_id" integer,
	"initiative_code" text,
	"legislator_source_id" text,
	"commission_name" text,
	"chamber" text,
	"raw" jsonb,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"seen" integer DEFAULT 0 NOT NULL,
	"inserted" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"status_changes" integer DEFAULT 0 NOT NULL,
	"ok" boolean,
	"error" text,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "initiatives" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"kind" text NOT NULL,
	"code" text,
	"title" text NOT NULL,
	"purpose" text,
	"type" text,
	"status" text,
	"chamber" text,
	"source_category" text,
	"category" text,
	"category_confidence" real,
	"sponsor" text,
	"sponsor_role" text,
	"sponsor_count" integer,
	"party" text,
	"province" text,
	"committee" text,
	"filed_at" text,
	"expires_at" text,
	"source_url" text,
	"risk_level" text,
	"approval_probability" text,
	"approval_score" integer,
	"needs_review" boolean DEFAULT true NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"raw" jsonb,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legislators" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"chamber" text NOT NULL,
	"full_name" text NOT NULL,
	"province" text,
	"circumscription" text,
	"party" text,
	"party_short" text,
	"role" text,
	"representation_level" text,
	"period" text,
	"photo_url" text,
	"email" text,
	"phone" text,
	"profession" text,
	"source_url" text,
	"raw" jsonb,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regulations" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"institution" text NOT NULL,
	"reg_type" text,
	"title" text NOT NULL,
	"purpose" text,
	"status" text,
	"intervention_level" text,
	"category" text,
	"province" text,
	"is_consulta" boolean DEFAULT false NOT NULL,
	"published_at" text,
	"deadline" text,
	"url" text,
	"needs_review" boolean DEFAULT true NOT NULL,
	"raw" jsonb,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "score_inputs" (
	"initiative_id" integer PRIMARY KEY NOT NULL,
	"party" text,
	"sponsor_record" text,
	"executive_support" text,
	"stakeholder_support" text,
	"social_pressure_count" integer,
	"provenance" jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"initiative_id" integer NOT NULL,
	"status" text NOT NULL,
	"event_date" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_initiatives" ADD CONSTRAINT "activity_initiatives_activity_id_activity_events_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activity_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_initiatives" ADD CONSTRAINT "activity_initiatives_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_item_entities" ADD CONSTRAINT "feed_item_entities_feed_item_id_feed_items_id_fk" FOREIGN KEY ("feed_item_id") REFERENCES "public"."feed_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_item_entities" ADD CONSTRAINT "feed_item_entities_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_items" ADD CONSTRAINT "feed_items_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_inputs" ADD CONSTRAINT "score_inputs_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_events" ADD CONSTRAINT "status_events_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_events_dedupe_uq" ON "activity_events" USING btree ("source","dedupe_key");--> statement-breakpoint
CREATE INDEX "activity_events_date_idx" ON "activity_events" USING btree ("event_date");--> statement-breakpoint
CREATE INDEX "activity_events_scope_idx" ON "activity_events" USING btree ("scope");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_initiatives_uq" ON "activity_initiatives" USING btree ("activity_id","initiative_code");--> statement-breakpoint
CREATE INDEX "activity_initiatives_code_idx" ON "activity_initiatives" USING btree ("initiative_code");--> statement-breakpoint
CREATE UNIQUE INDEX "commission_members_uq" ON "commission_members" USING btree ("source","commission_name","legislator_name");--> statement-breakpoint
CREATE INDEX "commission_members_commission_idx" ON "commission_members" USING btree ("commission_name");--> statement-breakpoint
CREATE INDEX "commission_members_chamber_idx" ON "commission_members" USING btree ("chamber");--> statement-breakpoint
CREATE UNIQUE INDEX "commissions_uq" ON "commissions" USING btree ("source","chamber","name");--> statement-breakpoint
CREATE INDEX "commissions_chamber_idx" ON "commissions" USING btree ("chamber");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_uq" ON "documents" USING btree ("source","source_doc_id");--> statement-breakpoint
CREATE INDEX "documents_initiative_idx" ON "documents" USING btree ("initiative_id");--> statement-breakpoint
CREATE INDEX "documents_code_idx" ON "documents" USING btree ("initiative_code");--> statement-breakpoint
CREATE UNIQUE INDEX "feed_accounts_uq" ON "feed_accounts" USING btree ("platform","handle");--> statement-breakpoint
CREATE INDEX "feed_accounts_kind_idx" ON "feed_accounts" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "feed_accounts_active_idx" ON "feed_accounts" USING btree ("active");--> statement-breakpoint
CREATE INDEX "feed_accounts_legislator_idx" ON "feed_accounts" USING btree ("legislator_source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feed_item_entities_uq" ON "feed_item_entities" USING btree ("feed_item_id","entity_type","label");--> statement-breakpoint
CREATE INDEX "feed_item_entities_initiative_idx" ON "feed_item_entities" USING btree ("initiative_id");--> statement-breakpoint
CREATE INDEX "feed_item_entities_legislator_idx" ON "feed_item_entities" USING btree ("legislator_source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feed_items_source_uq" ON "feed_items" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "feed_items_published_idx" ON "feed_items" USING btree ("published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "feed_items_kind_idx" ON "feed_items" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "feed_items_category_idx" ON "feed_items" USING btree ("category");--> statement-breakpoint
CREATE INDEX "feed_items_initiative_idx" ON "feed_items" USING btree ("initiative_id");--> statement-breakpoint
CREATE INDEX "feed_items_legislator_idx" ON "feed_items" USING btree ("legislator_source_id");--> statement-breakpoint
CREATE INDEX "ingestion_runs_source_started_idx" ON "ingestion_runs" USING btree ("source","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "initiatives_source_source_id_uq" ON "initiatives" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "initiatives_category_idx" ON "initiatives" USING btree ("category");--> statement-breakpoint
CREATE INDEX "initiatives_risk_idx" ON "initiatives" USING btree ("risk_level");--> statement-breakpoint
CREATE INDEX "initiatives_chamber_idx" ON "initiatives" USING btree ("chamber");--> statement-breakpoint
CREATE INDEX "initiatives_filed_at_idx" ON "initiatives" USING btree ("filed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "legislators_source_uq" ON "legislators" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "legislators_chamber_idx" ON "legislators" USING btree ("chamber");--> statement-breakpoint
CREATE INDEX "legislators_province_idx" ON "legislators" USING btree ("province");--> statement-breakpoint
CREATE UNIQUE INDEX "regulations_source_uq" ON "regulations" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "regulations_institution_idx" ON "regulations" USING btree ("institution");--> statement-breakpoint
CREATE INDEX "regulations_intervention_idx" ON "regulations" USING btree ("intervention_level");--> statement-breakpoint
CREATE INDEX "regulations_consulta_idx" ON "regulations" USING btree ("is_consulta");--> statement-breakpoint
CREATE UNIQUE INDEX "status_events_uq" ON "status_events" USING btree ("initiative_id","status","event_date");--> statement-breakpoint
CREATE INDEX "status_events_initiative_idx" ON "status_events" USING btree ("initiative_id");
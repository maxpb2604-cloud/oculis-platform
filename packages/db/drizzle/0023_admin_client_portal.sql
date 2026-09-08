CREATE TABLE "clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "clients_slug_check" CHECK ("clients"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "clients_name_check" CHECK (length(trim("clients"."name")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "clients_slug_uq" ON "clients" USING btree ("slug");
--> statement-breakpoint
CREATE INDEX "clients_active_idx" ON "clients" USING btree ("active");
--> statement-breakpoint
CREATE TABLE "portal_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text,
	"role" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "portal_users_identity_check" CHECK (length(trim("portal_users"."email")) > 3 and position('@' in "portal_users"."email") > 1 and length(trim("portal_users"."display_name")) > 0),
	CONSTRAINT "portal_users_role_scope_check" CHECK (("portal_users"."role" = 'ADMIN' and "portal_users"."client_id" is null) or ("portal_users"."role" = 'CLIENT' and "portal_users"."client_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "portal_users" ADD CONSTRAINT "portal_users_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_users_email_uq" ON "portal_users" USING btree (lower("email"));
--> statement-breakpoint
CREATE INDEX "portal_users_client_idx" ON "portal_users" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX "portal_users_role_idx" ON "portal_users" USING btree ("role");
--> statement-breakpoint
CREATE TABLE "client_initiative_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"initiative_id" integer,
	"regulation_id" integer,
	"impact_on_business" text NOT NULL,
	"executive_support" text NOT NULL,
	"key_stakeholder_support" text NOT NULL,
	"public_opinion" text NOT NULL,
	"internal_note" text,
	"assigned_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "client_assignments_exactly_one_record_check" CHECK (num_nonnulls("client_initiative_assignments"."initiative_id", "client_initiative_assignments"."regulation_id") = 1),
	CONSTRAINT "client_assignments_impact_check" CHECK ("client_initiative_assignments"."impact_on_business" in ('HIGH', 'MEDIUM', 'LOW', 'TO_ASSESS')),
	CONSTRAINT "client_assignments_executive_support_check" CHECK ("client_initiative_assignments"."executive_support" in ('SUPPORTS', 'NEUTRAL', 'OPPOSES', 'UNKNOWN')),
	CONSTRAINT "client_assignments_stakeholder_support_check" CHECK ("client_initiative_assignments"."key_stakeholder_support" in ('SUPPORTS', 'MIXED', 'OPPOSES', 'UNKNOWN')),
	CONSTRAINT "client_assignments_public_opinion_check" CHECK ("client_initiative_assignments"."public_opinion" in ('FAVORABLE', 'MIXED', 'UNFAVORABLE', 'UNKNOWN'))
);
--> statement-breakpoint
ALTER TABLE "client_initiative_assignments" ADD CONSTRAINT "client_assignments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "client_initiative_assignments" ADD CONSTRAINT "client_assignments_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "client_initiative_assignments" ADD CONSTRAINT "client_assignments_regulation_id_regulations_id_fk" FOREIGN KEY ("regulation_id") REFERENCES "public"."regulations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "client_initiative_assignments" ADD CONSTRAINT "client_assignments_assigned_by_user_id_portal_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."portal_users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "client_assignments_legislative_uq" ON "client_initiative_assignments" USING btree ("client_id", "initiative_id") WHERE "client_initiative_assignments"."initiative_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "client_assignments_regulatory_uq" ON "client_initiative_assignments" USING btree ("client_id", "regulation_id") WHERE "client_initiative_assignments"."regulation_id" is not null;
--> statement-breakpoint
CREATE INDEX "client_assignments_client_idx" ON "client_initiative_assignments" USING btree ("client_id", "updated_at" DESC NULLS LAST);

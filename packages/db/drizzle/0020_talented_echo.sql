CREATE TABLE "initiative_proponent_reconciliation_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"initiative_source" text NOT NULL,
	"person_namespace" text NOT NULL,
	"roster_source" text NOT NULL,
	"chamber" text NOT NULL,
	"compatibility_version" integer NOT NULL,
	"resolver_version" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"source_candidate_count" integer NOT NULL,
	"source_max_initiative_id" integer,
	"source_fingerprint" text NOT NULL,
	"processed_candidate_count" integer,
	"observed_candidate_count" integer,
	"replaced_candidate_count" integer,
	"skipped_unobserved_count" integer,
	"unresolved_proponent_count" integer,
	"failure_count" integer,
	"failure_reason" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "initiative_proponent_reconciliation_identity_check" CHECK (length(trim("initiative_proponent_reconciliation_runs"."initiative_source")) > 0
          and length(trim("initiative_proponent_reconciliation_runs"."person_namespace")) > 0
          and length(trim("initiative_proponent_reconciliation_runs"."roster_source")) > 0
          and length(trim("initiative_proponent_reconciliation_runs"."chamber")) > 0
          and length(trim("initiative_proponent_reconciliation_runs"."resolver_version")) > 0),
	CONSTRAINT "initiative_proponent_reconciliation_status_check" CHECK ("initiative_proponent_reconciliation_runs"."status" in ('running', 'complete', 'failed')),
	CONSTRAINT "initiative_proponent_reconciliation_compat_version_check" CHECK ("initiative_proponent_reconciliation_runs"."compatibility_version" > 0),
	CONSTRAINT "initiative_proponent_reconciliation_captured_counts_check" CHECK ("initiative_proponent_reconciliation_runs"."source_candidate_count" >= 0
          and ("initiative_proponent_reconciliation_runs"."source_max_initiative_id" is null or "initiative_proponent_reconciliation_runs"."source_max_initiative_id" > 0)
          and "initiative_proponent_reconciliation_runs"."source_fingerprint" ~ '^[a-f0-9]{32}$'),
	CONSTRAINT "initiative_proponent_reconciliation_result_counts_check" CHECK (("initiative_proponent_reconciliation_runs"."processed_candidate_count" is null or "initiative_proponent_reconciliation_runs"."processed_candidate_count" >= 0)
          and ("initiative_proponent_reconciliation_runs"."observed_candidate_count" is null or "initiative_proponent_reconciliation_runs"."observed_candidate_count" >= 0)
          and ("initiative_proponent_reconciliation_runs"."replaced_candidate_count" is null or "initiative_proponent_reconciliation_runs"."replaced_candidate_count" >= 0)
          and ("initiative_proponent_reconciliation_runs"."skipped_unobserved_count" is null or "initiative_proponent_reconciliation_runs"."skipped_unobserved_count" >= 0)
          and ("initiative_proponent_reconciliation_runs"."unresolved_proponent_count" is null or "initiative_proponent_reconciliation_runs"."unresolved_proponent_count" >= 0)
          and ("initiative_proponent_reconciliation_runs"."failure_count" is null or "initiative_proponent_reconciliation_runs"."failure_count" >= 0)),
	CONSTRAINT "initiative_proponent_reconciliation_completion_check" CHECK (("initiative_proponent_reconciliation_runs"."status" = 'running' and "initiative_proponent_reconciliation_runs"."completed_at" is null)
          or ("initiative_proponent_reconciliation_runs"."status" <> 'running' and "initiative_proponent_reconciliation_runs"."completed_at" is not null))
);
--> statement-breakpoint
CREATE INDEX "initiative_proponent_reconciliation_compat_idx" ON "initiative_proponent_reconciliation_runs" USING btree ("roster_source","chamber","initiative_source","person_namespace","compatibility_version","completed_at" DESC NULLS LAST);
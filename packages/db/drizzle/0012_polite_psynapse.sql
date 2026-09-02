ALTER TABLE "document_summaries" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
-- Both columns are nullable and have no defaults: every pre-0012 summary remains
-- explicitly unreviewed until a human supplies both values together.
ALTER TABLE "document_summaries" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "document_summaries" ADD CONSTRAINT "document_summaries_review_gate_check" CHECK (("document_summaries"."reviewed_at" is null and "document_summaries"."reviewed_by" is null)
          or ("document_summaries"."reviewed_at" is not null
              and "document_summaries"."reviewed_by" is not null
              and length(trim("document_summaries"."reviewed_by")) > 0));

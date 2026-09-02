ALTER TABLE "document_summaries" DROP CONSTRAINT "document_summaries_review_gate_check";--> statement-breakpoint
DROP INDEX "document_summaries_content_hash_model_prompt_uq";--> statement-breakpoint
ALTER TABLE "document_summaries" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "document_summaries" ADD COLUMN "rejected_at" timestamp;--> statement-breakpoint
ALTER TABLE "document_summaries" ADD COLUMN "rejected_by" text;--> statement-breakpoint
ALTER TABLE "document_summaries" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
CREATE UNIQUE INDEX "document_summaries_content_hash_model_prompt_attempt_uq" ON "document_summaries" USING btree ("document_content_id","content_hash","model","prompt_hash","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "document_summaries_one_active_uq" ON "document_summaries" USING btree ("document_content_id","content_hash","model","prompt_hash") WHERE "document_summaries"."rejected_at" is null;--> statement-breakpoint
ALTER TABLE "document_summaries" ADD CONSTRAINT "document_summaries_positive_attempt_check" CHECK ("document_summaries"."attempt" > 0);--> statement-breakpoint
ALTER TABLE "document_summaries" ADD CONSTRAINT "document_summaries_publication_state_check" CHECK ((
            "document_summaries"."reviewed_at" is null and "document_summaries"."reviewed_by" is null
            and "document_summaries"."rejected_at" is null and "document_summaries"."rejected_by" is null
            and "document_summaries"."rejection_reason" is null
          ) or (
            "document_summaries"."reviewed_at" is not null and "document_summaries"."reviewed_by" is not null
            and length(trim("document_summaries"."reviewed_by")) > 0
            and "document_summaries"."rejected_at" is null and "document_summaries"."rejected_by" is null
            and "document_summaries"."rejection_reason" is null
          ) or (
            "document_summaries"."reviewed_at" is null and "document_summaries"."reviewed_by" is null
            and "document_summaries"."rejected_at" is not null and "document_summaries"."rejected_by" is not null
            and length(trim("document_summaries"."rejected_by")) > 0
            and "document_summaries"."rejection_reason" is not null
            and length(trim("document_summaries"."rejection_reason")) > 0
          ));
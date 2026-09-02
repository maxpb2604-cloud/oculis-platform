ALTER TABLE "document_summaries" DROP CONSTRAINT "document_summaries_publication_state_check";--> statement-breakpoint
DROP INDEX "document_summaries_one_active_uq";--> statement-breakpoint
ALTER TABLE "document_summaries" ADD COLUMN "withdrawn_at" timestamp;--> statement-breakpoint
ALTER TABLE "document_summaries" ADD COLUMN "withdrawn_by" text;--> statement-breakpoint
ALTER TABLE "document_summaries" ADD COLUMN "withdrawal_reason" text;--> statement-breakpoint
CREATE UNIQUE INDEX "document_summaries_one_active_uq" ON "document_summaries" USING btree ("document_content_id","content_hash","model","prompt_hash") WHERE "document_summaries"."rejected_at" is null and "document_summaries"."withdrawn_at" is null;--> statement-breakpoint
ALTER TABLE "document_summaries" ADD CONSTRAINT "document_summaries_publication_state_check" CHECK ((
            "document_summaries"."reviewed_at" is null and "document_summaries"."reviewed_by" is null
            and "document_summaries"."rejected_at" is null and "document_summaries"."rejected_by" is null
            and "document_summaries"."rejection_reason" is null
            and "document_summaries"."withdrawn_at" is null and "document_summaries"."withdrawn_by" is null
            and "document_summaries"."withdrawal_reason" is null
          ) or (
            "document_summaries"."reviewed_at" is not null and "document_summaries"."reviewed_by" is not null
            and length(trim("document_summaries"."reviewed_by")) > 0
            and "document_summaries"."rejected_at" is null and "document_summaries"."rejected_by" is null
            and "document_summaries"."rejection_reason" is null
            and "document_summaries"."withdrawn_at" is null and "document_summaries"."withdrawn_by" is null
            and "document_summaries"."withdrawal_reason" is null
          ) or (
            "document_summaries"."reviewed_at" is null and "document_summaries"."reviewed_by" is null
            and "document_summaries"."rejected_at" is not null and "document_summaries"."rejected_by" is not null
            and length(trim("document_summaries"."rejected_by")) > 0
            and "document_summaries"."rejection_reason" is not null
            and length(trim("document_summaries"."rejection_reason")) > 0
            and "document_summaries"."withdrawn_at" is null and "document_summaries"."withdrawn_by" is null
            and "document_summaries"."withdrawal_reason" is null
          ) or (
            "document_summaries"."reviewed_at" is not null and "document_summaries"."reviewed_by" is not null
            and length(trim("document_summaries"."reviewed_by")) > 0
            and "document_summaries"."rejected_at" is null and "document_summaries"."rejected_by" is null
            and "document_summaries"."rejection_reason" is null
            and "document_summaries"."withdrawn_at" is not null and "document_summaries"."withdrawn_by" is not null
            and length(trim("document_summaries"."withdrawn_by")) > 0
            and "document_summaries"."withdrawal_reason" is not null
            and length(trim("document_summaries"."withdrawal_reason")) > 0
          ));
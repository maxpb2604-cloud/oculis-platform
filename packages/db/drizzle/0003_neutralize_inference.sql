CREATE TABLE "inference_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"inference_kind" text NOT NULL,
	"value" jsonb NOT NULL,
	"provenance" jsonb,
	"archived_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "inference_audit_entity_kind_uq" ON "inference_audit" ("entity_type", "entity_id", "inference_kind");
--> statement-breakpoint
CREATE INDEX "inference_audit_entity_idx" ON "inference_audit" ("entity_type", "entity_id");
--> statement-breakpoint

ALTER TABLE "status_events" ADD COLUMN "source" text;
--> statement-breakpoint
ALTER TABLE "status_events" ADD COLUMN "source_url" text;
--> statement-breakpoint
ALTER TABLE "status_events" ADD COLUMN "evidence_type" text DEFAULT 'SOURCE_HISTORY' NOT NULL;
--> statement-breakpoint
ALTER TABLE "status_events" ADD COLUMN "raw" jsonb;
--> statement-breakpoint
ALTER TABLE "status_events" ADD COLUMN "observed_at" timestamp;
--> statement-breakpoint
-- Pre-migration events did not store their own source evidence. The parent initiative's
-- current source cannot be retroactively promoted into event provenance.
UPDATE "status_events"
   SET "source" = 'legacy-unattributed',
       "source_url" = NULL,
       "evidence_type" = 'LEGACY_UNATTRIBUTED',
       "observed_at" = coalesce("observed_at", "created_at")
 WHERE "source" IS NULL;
--> statement-breakpoint
ALTER TABLE "status_events" ALTER COLUMN "source" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "status_events" ALTER COLUMN "observed_at" SET DEFAULT now();
--> statement-breakpoint
ALTER TABLE "status_events" ALTER COLUMN "observed_at" SET NOT NULL;
--> statement-breakpoint

INSERT INTO "inference_audit" ("entity_type", "entity_id", "inference_kind", "value", "provenance")
SELECT 'initiative', "id", 'legacy_inference',
       jsonb_build_object(
         'category', "category",
         'categoryConfidence', "category_confidence",
         'riskLevel', "risk_level",
         'approvalProbability', "approval_probability",
         'approvalScore', "approval_score",
         'needsReview', "needs_review",
         'published', "published"
       ),
       jsonb_build_object('source', "source", 'sourceCategory', "source_category", 'sourceUrl', "source_url")
  FROM "initiatives"
 WHERE "category" IS NOT NULL OR "category_confidence" IS NOT NULL OR "risk_level" IS NOT NULL
    OR "approval_probability" IS NOT NULL OR "approval_score" IS NOT NULL
    OR "needs_review" = true OR "published" = true;
--> statement-breakpoint
INSERT INTO "inference_audit" ("entity_type", "entity_id", "inference_kind", "value", "provenance")
SELECT 'initiative', "initiative_id", 'legacy_score_inputs',
       jsonb_build_object(
         'party', "party",
         'sponsorRecord', "sponsor_record",
         'executiveSupport', "executive_support",
         'stakeholderSupport', "stakeholder_support",
         'socialPressureCount', "social_pressure_count"
       ), "provenance"
  FROM "score_inputs";
--> statement-breakpoint
INSERT INTO "inference_audit" ("entity_type", "entity_id", "inference_kind", "value", "provenance")
SELECT 'regulation', "id", 'legacy_inference',
       jsonb_build_object('interventionLevel', "intervention_level", 'category', "category", 'needsReview', "needs_review"),
       jsonb_build_object('source', "source", 'sourceUrl', "url")
  FROM "regulations"
 WHERE "intervention_level" IS NOT NULL OR "category" IS NOT NULL OR "needs_review" = true;
--> statement-breakpoint
INSERT INTO "inference_audit" ("entity_type", "entity_id", "inference_kind", "value", "provenance")
SELECT 'feed_item', "id", 'legacy_category', jsonb_build_object('category', "category"),
       jsonb_build_object('source', "source", 'sourceUrl', "url")
  FROM "feed_items" WHERE "category" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "inference_audit" ("entity_type", "entity_id", "inference_kind", "value", "provenance")
SELECT 'feed_account', "id", 'legacy_influence_rank', jsonb_build_object('influenceRank', "influence_rank"),
       jsonb_build_object('platform', "platform", 'handle', "handle", 'url', "url")
  FROM "feed_accounts" WHERE "influence_rank" IS NOT NULL;
--> statement-breakpoint

UPDATE "initiatives"
   SET "category" = NULL,
       "category_confidence" = NULL,
       "risk_level" = NULL,
       "approval_probability" = NULL,
       "approval_score" = NULL,
       "needs_review" = false,
       "published" = false;
--> statement-breakpoint
DELETE FROM "score_inputs";
--> statement-breakpoint
UPDATE "regulations" SET "intervention_level" = NULL, "category" = NULL, "needs_review" = false;
--> statement-breakpoint
UPDATE "feed_items" SET "category" = NULL;
--> statement-breakpoint
UPDATE "feed_accounts" SET "influence_rank" = NULL;
--> statement-breakpoint

DROP INDEX IF EXISTS "feed_items_category_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "initiatives_category_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "initiatives_risk_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "regulations_intervention_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "status_events_uq";
--> statement-breakpoint
DROP INDEX IF EXISTS "status_events_null_date_uq";
--> statement-breakpoint
ALTER TABLE "initiatives" ALTER COLUMN "needs_review" SET DEFAULT false;
--> statement-breakpoint
ALTER TABLE "regulations" ALTER COLUMN "needs_review" SET DEFAULT false;
--> statement-breakpoint
CREATE INDEX "initiatives_source_category_idx" ON "initiatives" ("source_category");
--> statement-breakpoint
CREATE UNIQUE INDEX "status_events_evidence_uq" ON "status_events" ("initiative_id", "status", "event_date", "evidence_type")
WHERE "evidence_type" = 'SOURCE_HISTORY' AND "event_date" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "status_events_evidence_null_date_uq" ON "status_events" ("initiative_id", "status", "evidence_type")
WHERE "evidence_type" = 'SOURCE_HISTORY' AND "event_date" IS NULL;
--> statement-breakpoint

ALTER TABLE "feed_accounts" ADD CONSTRAINT "feed_accounts_no_influence_rank_check" CHECK ("influence_rank" is null);
--> statement-breakpoint
ALTER TABLE "feed_items" ADD CONSTRAINT "feed_items_no_inferred_category_check" CHECK ("category" is null);
--> statement-breakpoint
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_no_inferred_values_check" CHECK (
  "category" is null
  and "category_confidence" is null
  and "risk_level" is null
  and "approval_probability" is null
  and "approval_score" is null
  and "needs_review" = false
  and "published" = false
);
--> statement-breakpoint
ALTER TABLE "regulations" ADD CONSTRAINT "regulations_no_inferred_values_check" CHECK (
  "intervention_level" is null and "category" is null and "needs_review" = false
);
--> statement-breakpoint
ALTER TABLE "score_inputs" ADD CONSTRAINT "score_inputs_no_inferred_values_check" CHECK (
  "party" is null
  and "sponsor_record" is null
  and "executive_support" is null
  and "stakeholder_support" is null
  and "social_pressure_count" is null
);

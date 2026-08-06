ALTER TABLE "commission_members" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "legislators" ADD COLUMN "active" boolean DEFAULT true NOT NULL;
ALTER TABLE "organizations" ADD COLUMN "onboarding_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "onboarding_progress" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
-- D-095: organizations that already exist are not pushed through the first-run wizard.
UPDATE "organizations" SET "onboarding_completed_at" = now();

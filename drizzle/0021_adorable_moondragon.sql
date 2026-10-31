ALTER TABLE "organizations" ADD COLUMN "ai_autonomy" text DEFAULT 'balanced' NOT NULL;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "auto_run" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "undo" jsonb;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "undone_at" timestamp with time zone;
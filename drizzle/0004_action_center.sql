CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."finding_rule" AS ENUM('invoice_overdue', 'invoice_draft_ready', 'renewal_upcoming', 'task_late', 'lead_stagnant');--> statement-breakpoint
CREATE TYPE "public"."finding_status" AS ENUM('new', 'handled', 'ignored', 'snoozed', 'auto_resolved');--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"finding_id" text,
	"tool" text NOT NULL,
	"args" jsonb NOT NULL,
	"rationale" text NOT NULL,
	"requested_for" text NOT NULL,
	"ai_run_id" text,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"execution_result" jsonb,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_approvals_org_id" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "briefings" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"briefing_date" date NOT NULL,
	"content" text NOT NULL,
	"is_ai" boolean NOT NULL,
	"ai_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"rule" "finding_rule" NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"period_key" text NOT NULL,
	"status" "finding_status" DEFAULT 'new' NOT NULL,
	"snoozed_until" timestamp with time zone,
	"explanation" text,
	"draft_message" text,
	"ai_run_id" text,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_findings_org_id" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "fk_approvals_finding" FOREIGN KEY ("org_id","finding_id") REFERENCES "public"."findings"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "fk_approvals_requested_for" FOREIGN KEY ("org_id","requested_for") REFERENCES "public"."users"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "fk_approvals_ai_run" FOREIGN KEY ("org_id","ai_run_id") REFERENCES "public"."ai_runs"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "fk_approvals_decided_by" FOREIGN KEY ("org_id","decided_by") REFERENCES "public"."users"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefings" ADD CONSTRAINT "briefings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefings" ADD CONSTRAINT "fk_briefings_ai_run" FOREIGN KEY ("org_id","ai_run_id") REFERENCES "public"."ai_runs"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "fk_findings_ai_run" FOREIGN KEY ("org_id","ai_run_id") REFERENCES "public"."ai_runs"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "fk_findings_resolved_by" FOREIGN KEY ("org_id","resolved_by") REFERENCES "public"."users"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_approvals_queue" ON "approvals" USING btree ("org_id","status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_briefings_day" ON "briefings" USING btree ("org_id","briefing_date");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_findings_dedupe" ON "findings" USING btree ("org_id","rule","entity_id","period_key");--> statement-breakpoint
CREATE INDEX "idx_findings_status" ON "findings" USING btree ("org_id","status","created_at");
CREATE TYPE "public"."ai_feature" AS ENUM('agent', 'minutes', 'transcribe', 'image');--> statement-breakpoint
CREATE TYPE "public"."ai_run_status" AS ENUM('ok', 'error', 'blocked_budget', 'rejected_tool');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "ai_budgets" (
	"org_id" text NOT NULL,
	"feature" "ai_feature" NOT NULL,
	"daily_limit_micro_usd" bigint NOT NULL,
	CONSTRAINT "ai_budgets_org_id_feature_pk" PRIMARY KEY("org_id","feature"),
	CONSTRAINT "ai_budgets_limit_ck" CHECK ("ai_budgets"."daily_limit_micro_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"feature" "ai_feature" NOT NULL,
	"on_behalf_of" text,
	"model" text NOT NULL,
	"status" "ai_run_status" NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"audio_ms" integer,
	"images" integer,
	"cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_summary" text,
	"output_summary" text,
	"error" text,
	"entity_type" text,
	"entity_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "uq_ai_runs_org_id" UNIQUE("org_id","id"),
	CONSTRAINT "ai_runs_cost_ck" CHECK ("ai_runs"."cost_micro_usd" >= 0 and "ai_runs"."input_tokens" >= 0 and "ai_runs"."output_tokens" >= 0)
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"actor" text NOT NULL,
	"actor_user_id" text,
	"ai_run_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"rule" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result" jsonb
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"max_attempts" smallint DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "jobs_attempts_ck" CHECK ("jobs"."attempts" >= 0 and "jobs"."max_attempts" > 0)
);
--> statement-breakpoint
ALTER TABLE "ai_budgets" ADD CONSTRAINT "ai_budgets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "fk_ai_runs_user" FOREIGN KEY ("org_id","on_behalf_of") REFERENCES "public"."users"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_runs_budget" ON "ai_runs" USING btree ("org_id","feature","started_at");--> statement-breakpoint
CREATE INDEX "idx_audit_log_entity" ON "audit_log" USING btree ("org_id","entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_log_time" ON "audit_log" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_automation_runs_key" ON "automation_runs" USING btree ("org_id","rule","dedupe_key");--> statement-breakpoint
CREATE INDEX "idx_jobs_queue" ON "jobs" USING btree ("run_after") WHERE "jobs"."status" = 'queued';
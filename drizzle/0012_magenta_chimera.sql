CREATE TYPE "public"."uptime_state" AS ENUM('up', 'down');--> statement-breakpoint
CREATE TYPE "public"."connection_kind" AS ENUM('github', 'ssh', 'aapanel');--> statement-breakpoint
CREATE TYPE "public"."connection_test" AS ENUM('untested', 'ok', 'failed');--> statement-breakpoint
CREATE TYPE "public"."run_kind" AS ENUM('setup', 'update');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('planned', 'awaiting_approval', 'running', 'paused', 'done', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."setup_mode" AS ENUM('branch_per_client', 'shared_branch');--> statement-breakpoint
CREATE TYPE "public"."step_status" AS ENUM('pending', 'running', 'done', 'failed', 'skipped');--> statement-breakpoint
ALTER TYPE "public"."finding_rule" ADD VALUE 'deployment_outdated';--> statement-breakpoint
ALTER TYPE "public"."finding_rule" ADD VALUE 'deployment_down';--> statement-breakpoint
CREATE TABLE "connections" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"kind" "connection_kind" NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_ciphertext" text,
	"secret_key_version" smallint,
	"secret_hint" text,
	"host_key_fingerprint" text,
	"test_status" "connection_test" DEFAULT 'untested' NOT NULL,
	"tested_at" timestamp with time zone,
	"test_message" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_connections_org_id" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "playbook_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"product_id" text NOT NULL,
	"client_id" text,
	"deployment_id" text,
	"server_connection_id" text NOT NULL,
	"kind" "run_kind" NOT NULL,
	"status" "run_status" DEFAULT 'planned' NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"approval_id" text,
	"summary" text,
	"error" text,
	"created_by" text NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_playbook_runs_org_id" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "playbook_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"run_id" text NOT NULL,
	"position" integer NOT NULL,
	"step_key" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "step_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"output" text,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "uq_playbook_steps_position" UNIQUE("run_id","position"),
	CONSTRAINT "playbook_steps_position_ck" CHECK ("playbook_steps"."position" >= 1)
);
--> statement-breakpoint
CREATE TABLE "product_setups" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"product_id" text NOT NULL,
	"github_connection_id" text,
	"repo" text,
	"default_branch" text,
	"mode" "setup_mode" DEFAULT 'branch_per_client' NOT NULL,
	"folder_pattern" text,
	"server_connection_id" text,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"nginx_template" text,
	"env_template" text,
	"rules_notes" text,
	"is_ai_draft" boolean DEFAULT false NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_product_setups_product" UNIQUE("product_id")
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "uptime_interval_min" smallint DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "step_timeout_sec" integer DEFAULT 300 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "code_check_interval_min" smallint DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "repo" text;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "branch" text;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "server_connection_id" text;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "app_path" text;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "deployed_commit" text;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "latest_commit" text;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "behind_by" integer;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "code_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "uptime_state" "uptime_state";--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "uptime_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "uptime_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "uptime_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_runs" ADD CONSTRAINT "playbook_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_runs" ADD CONSTRAINT "fk_playbook_runs_product" FOREIGN KEY ("org_id","product_id") REFERENCES "public"."products"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_runs" ADD CONSTRAINT "fk_playbook_runs_client" FOREIGN KEY ("org_id","client_id") REFERENCES "public"."clients"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_runs" ADD CONSTRAINT "fk_playbook_runs_deployment" FOREIGN KEY ("org_id","deployment_id") REFERENCES "public"."deployments"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_runs" ADD CONSTRAINT "fk_playbook_runs_server" FOREIGN KEY ("org_id","server_connection_id") REFERENCES "public"."connections"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_runs" ADD CONSTRAINT "fk_playbook_runs_approval" FOREIGN KEY ("org_id","approval_id") REFERENCES "public"."approvals"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_steps" ADD CONSTRAINT "fk_playbook_steps_run" FOREIGN KEY ("org_id","run_id") REFERENCES "public"."playbook_runs"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_setups" ADD CONSTRAINT "product_setups_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_setups" ADD CONSTRAINT "fk_product_setups_product" FOREIGN KEY ("org_id","product_id") REFERENCES "public"."products"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_setups" ADD CONSTRAINT "fk_product_setups_github" FOREIGN KEY ("org_id","github_connection_id") REFERENCES "public"."connections"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_setups" ADD CONSTRAINT "fk_product_setups_server" FOREIGN KEY ("org_id","server_connection_id") REFERENCES "public"."connections"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_connections_name" ON "connections" USING btree ("org_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "uq_playbook_runs_running" ON "playbook_runs" USING btree ("server_connection_id") WHERE "playbook_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "idx_playbook_runs_org" ON "playbook_runs" USING btree ("org_id","created_at");--> statement-breakpoint
-- The deployments/connections cycle (ERD 3.2 and 3.9): the link is added once both tables exist, as for meetings and documents.
ALTER TABLE "deployments" ADD CONSTRAINT "fk_deployments_server_connection" FOREIGN KEY ("org_id","server_connection_id") REFERENCES "public"."connections"("org_id","id") ON DELETE no action ON UPDATE no action;

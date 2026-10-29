CREATE TYPE "public"."flow_kind" AS ENUM('setup', 'update');--> statement-breakpoint
CREATE TABLE "flow_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"flow_id" text NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"has_command_node" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_flow_versions_org_id" UNIQUE("org_id","id"),
	CONSTRAINT "uq_flow_versions_version" UNIQUE("flow_id","version"),
	CONSTRAINT "flow_versions_version_ck" CHECK ("flow_versions"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "flows" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" "flow_kind" NOT NULL,
	"description" text,
	"product_id" text,
	"current_version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_flows_org_id" UNIQUE("org_id","id")
);
--> statement-breakpoint
DROP INDEX "uq_playbook_runs_running";--> statement-breakpoint
ALTER TABLE "playbook_runs" ALTER COLUMN "server_connection_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "app_port" integer;--> statement-breakpoint
ALTER TABLE "playbook_runs" ADD COLUMN "flow_version_id" text;--> statement-breakpoint
ALTER TABLE "playbook_runs" ADD COLUMN "bindings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "playbook_runs" ADD COLUMN "plan_hash" text;--> statement-breakpoint
ALTER TABLE "playbook_runs" ADD COLUMN "secrets_ciphertext" text;--> statement-breakpoint
ALTER TABLE "playbook_runs" ADD COLUMN "secrets_key_version" smallint;--> statement-breakpoint
ALTER TABLE "playbook_steps" ADD COLUMN "tool" text;--> statement-breakpoint
ALTER TABLE "playbook_steps" ADD COLUMN "outputs" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "product_setups" ADD COLUMN "setup_flow_id" text;--> statement-breakpoint
ALTER TABLE "product_setups" ADD COLUMN "update_flow_id" text;--> statement-breakpoint
ALTER TABLE "product_setups" ADD COLUMN "port_range_start" integer;--> statement-breakpoint
ALTER TABLE "product_setups" ADD COLUMN "port_range_end" integer;--> statement-breakpoint
ALTER TABLE "flow_versions" ADD CONSTRAINT "fk_flow_versions_flow" FOREIGN KEY ("org_id","flow_id") REFERENCES "public"."flows"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "fk_flows_product" FOREIGN KEY ("org_id","product_id") REFERENCES "public"."products"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_flows_name" ON "flows" USING btree ("org_id",lower("name")) WHERE "flows"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "playbook_runs" ADD CONSTRAINT "fk_playbook_runs_flow_version" FOREIGN KEY ("org_id","flow_version_id") REFERENCES "public"."flow_versions"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_setups" ADD CONSTRAINT "fk_product_setups_setup_flow" FOREIGN KEY ("org_id","setup_flow_id") REFERENCES "public"."flows"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_setups" ADD CONSTRAINT "fk_product_setups_update_flow" FOREIGN KEY ("org_id","update_flow_id") REFERENCES "public"."flows"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_deployments_server_port" ON "deployments" USING btree ("server_connection_id","app_port") WHERE "deployments"."server_connection_id" is not null and "deployments"."app_port" is not null;--> statement-breakpoint
ALTER TABLE "product_setups" ADD CONSTRAINT "product_setups_port_range_ck" CHECK ("product_setups"."port_range_start" is null or "product_setups"."port_range_end" is null or "product_setups"."port_range_start" <= "product_setups"."port_range_end");--> statement-breakpoint
-- A flow version never changes and is never deleted: a run keeps the version it was approved with (ERD 3.9, BR-M17-20).
CREATE OR REPLACE FUNCTION guard_flow_version_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'flow versions are immutable: save a new version instead'
    USING ERRCODE = 'restrict_violation';
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER flow_versions_immutable
  BEFORE UPDATE OR DELETE ON flow_versions
  FOR EACH ROW EXECUTE FUNCTION guard_flow_version_immutable();

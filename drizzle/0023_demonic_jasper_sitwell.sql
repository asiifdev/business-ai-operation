CREATE TYPE "public"."video_status" AS ENUM('script', 'queued', 'rendering', 'done', 'failed');--> statement-breakpoint
ALTER TYPE "public"."file_kind" ADD VALUE 'marketing_video';--> statement-breakpoint
CREATE TABLE "video_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"product_id" text,
	"purpose" "marketing_purpose" NOT NULL,
	"seconds" smallint NOT NULL,
	"aspect" text DEFAULT 'story' NOT NULL,
	"narrator" text DEFAULT 'sinta' NOT NULL,
	"title" text NOT NULL,
	"script" jsonb NOT NULL,
	"status" "video_status" DEFAULT 'script' NOT NULL,
	"stage" text,
	"progress" smallint DEFAULT 0 NOT NULL,
	"error" text,
	"file_id" text,
	"duration_ms" integer,
	"speech_engine" text,
	"images_used" smallint DEFAULT 0 NOT NULL,
	"ai_run_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_video_projects_org_id" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "organization_profiles" ADD COLUMN "name_pronunciation" text;--> statement-breakpoint
ALTER TABLE "video_projects" ADD CONSTRAINT "video_projects_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_projects" ADD CONSTRAINT "video_projects_ai_run_id_ai_runs_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_projects" ADD CONSTRAINT "fk_video_projects_product" FOREIGN KEY ("org_id","product_id") REFERENCES "public"."products"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_projects" ADD CONSTRAINT "fk_video_projects_file" FOREIGN KEY ("org_id","file_id") REFERENCES "public"."files"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_video_projects_org_created" ON "video_projects" USING btree ("org_id","created_at");
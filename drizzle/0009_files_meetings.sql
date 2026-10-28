CREATE TYPE "public"."file_kind" AS ENUM('meeting_audio', 'marketing_image');--> statement-breakpoint
CREATE TYPE "public"."meeting_status" AS ENUM('uploaded', 'processing', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "files" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"kind" "file_kind" NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text,
	"original_name" text,
	"is_ai_generated" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "uq_files_storage_key" UNIQUE("storage_key"),
	CONSTRAINT "uq_files_org_id" UNIQUE("org_id","id"),
	CONSTRAINT "files_size_ck" CHECK ("files"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "meeting_turns" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"meeting_id" text NOT NULL,
	"seq" integer NOT NULL,
	"speaker" text,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "uq_meeting_turns_seq" UNIQUE("meeting_id","seq")
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"title" text NOT NULL,
	"source" text DEFAULT 'upload' NOT NULL,
	"file_id" text,
	"status" "meeting_status" DEFAULT 'uploaded' NOT NULL,
	"duration_ms" integer,
	"speaker_map" jsonb,
	"minutes_document_id" text,
	"error" text,
	"content_deleted_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_meetings_org_id" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "meeting_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "meeting_id" text;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_turns" ADD CONSTRAINT "fk_meeting_turns_meeting" FOREIGN KEY ("org_id","meeting_id") REFERENCES "public"."meetings"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "fk_meetings_file" FOREIGN KEY ("org_id","file_id") REFERENCES "public"."files"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_meetings_org_created" ON "meetings" USING btree ("org_id","created_at");--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "fk_leads_meeting" FOREIGN KEY ("org_id","meeting_id") REFERENCES "public"."meetings"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "fk_tasks_meeting" FOREIGN KEY ("org_id","meeting_id") REFERENCES "public"."meetings"("org_id","id") ON DELETE no action ON UPDATE no action;
CREATE TABLE "assistant_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"mime" text,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"source_url" text,
	"summary" text NOT NULL,
	"digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_assistant_attachments_org_id" UNIQUE("org_id","id"),
	CONSTRAINT "assistant_attachments_kind_ck" CHECK ("assistant_attachments"."kind" in ('pdf', 'image', 'video', 'audio', 'document', 'sheet', 'slides', 'text', 'link'))
);
--> statement-breakpoint
ALTER TABLE "assistant_attachments" ADD CONSTRAINT "assistant_attachments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_attachments" ADD CONSTRAINT "fk_assistant_attachments_user" FOREIGN KEY ("org_id","user_id") REFERENCES "public"."users"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_attachments" ADD CONSTRAINT "fk_assistant_attachments_session" FOREIGN KEY ("org_id","session_id") REFERENCES "public"."assistant_sessions"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_assistant_attachments_session" ON "assistant_attachments" USING btree ("org_id","session_id");
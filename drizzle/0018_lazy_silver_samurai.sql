CREATE TABLE "assistant_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"session_id" text NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_assistant_messages_seq" UNIQUE("session_id","seq"),
	CONSTRAINT "assistant_messages_kind_ck" CHECK ("assistant_messages"."kind" in ('user', 'assistant', 'error'))
);
--> statement-breakpoint
CREATE TABLE "assistant_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_assistant_sessions_org_id" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD CONSTRAINT "fk_assistant_messages_session" FOREIGN KEY ("org_id","session_id") REFERENCES "public"."assistant_sessions"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_sessions" ADD CONSTRAINT "assistant_sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_sessions" ADD CONSTRAINT "fk_assistant_sessions_user" FOREIGN KEY ("org_id","user_id") REFERENCES "public"."users"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_assistant_sessions_user" ON "assistant_sessions" USING btree ("org_id","user_id","updated_at");
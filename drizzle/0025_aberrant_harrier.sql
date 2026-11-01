ALTER TABLE "assistant_attachments" ALTER COLUMN "summary" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "assistant_attachments" ALTER COLUMN "digest" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "assistant_attachments" ADD COLUMN "content" "bytea";--> statement-breakpoint
ALTER TABLE "assistant_attachments" ADD COLUMN "read_at" timestamp with time zone;--> statement-breakpoint
UPDATE "assistant_attachments" SET "read_at" = "created_at" WHERE "read_at" IS NULL;

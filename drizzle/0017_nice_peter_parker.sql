ALTER TABLE "marketing_assets" ADD COLUMN "background_file_id" text;--> statement-breakpoint
ALTER TABLE "marketing_assets" ADD COLUMN "poster_copy" jsonb;--> statement-breakpoint
ALTER TABLE "marketing_assets" ADD CONSTRAINT "fk_marketing_assets_background" FOREIGN KEY ("org_id","background_file_id") REFERENCES "public"."files"("org_id","id") ON DELETE no action ON UPDATE no action;
ALTER TYPE "public"."file_kind" ADD VALUE 'product_logo';--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "logo_file_id" text;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "fk_products_logo" FOREIGN KEY ("org_id","logo_file_id") REFERENCES "public"."files"("org_id","id") ON DELETE no action ON UPDATE no action;
ALTER TYPE "public"."file_kind" ADD VALUE 'brand_logo';--> statement-breakpoint
ALTER TYPE "public"."marketing_purpose" ADD VALUE 'brand';--> statement-breakpoint
ALTER TABLE "marketing_assets" ALTER COLUMN "product_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD COLUMN "logo_file_id" text;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "fk_brand_kits_logo" FOREIGN KEY ("org_id","logo_file_id") REFERENCES "public"."files"("org_id","id") ON DELETE no action ON UPDATE no action;
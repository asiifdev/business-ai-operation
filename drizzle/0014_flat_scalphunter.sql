CREATE TYPE "public"."marketing_purpose" AS ENUM('launch', 'promo', 'education', 'release');--> statement-breakpoint
CREATE TABLE "brand_kits" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"brand_name" text NOT NULL,
	"colors" text,
	"tone" text,
	"prohibitions" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_brand_kits_org" UNIQUE("org_id")
);
--> statement-breakpoint
CREATE TABLE "marketing_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"product_id" text NOT NULL,
	"purpose" "marketing_purpose" NOT NULL,
	"prompt" text NOT NULL,
	"parent_asset_id" text,
	"file_id" text NOT NULL,
	"caption" text,
	"ai_run_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_marketing_assets_org_id" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_assets" ADD CONSTRAINT "marketing_assets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_assets" ADD CONSTRAINT "marketing_assets_ai_run_id_ai_runs_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_assets" ADD CONSTRAINT "fk_marketing_assets_product" FOREIGN KEY ("org_id","product_id") REFERENCES "public"."products"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_assets" ADD CONSTRAINT "fk_marketing_assets_parent" FOREIGN KEY ("org_id","parent_asset_id") REFERENCES "public"."marketing_assets"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_assets" ADD CONSTRAINT "fk_marketing_assets_file" FOREIGN KEY ("org_id","file_id") REFERENCES "public"."files"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_marketing_assets_org_created" ON "marketing_assets" USING btree ("org_id","created_at");
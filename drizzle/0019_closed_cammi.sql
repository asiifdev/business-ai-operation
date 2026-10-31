CREATE TABLE "org_services" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"tagline" text,
	"description" text,
	"industry" text,
	"website" text,
	"contact_email" text,
	"contact_phone" text,
	"address" text,
	"socials" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"target_audience" text,
	"value_props" text,
	"logo_file_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_organization_profiles_org" UNIQUE("org_id")
);
--> statement-breakpoint
ALTER TABLE "org_services" ADD CONSTRAINT "org_services_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_profiles" ADD CONSTRAINT "organization_profiles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_profiles" ADD CONSTRAINT "fk_organization_profiles_logo" FOREIGN KEY ("org_id","logo_file_id") REFERENCES "public"."files"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_org_services_name" ON "org_services" USING btree ("org_id",lower("name"));--> statement-breakpoint
-- D-079: the company logo moves from brand_kits to the profile. brand_kits.logo_file_id stays but is no longer read.
INSERT INTO "organization_profiles" ("id", "org_id", "logo_file_id")
SELECT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 26)), "org_id", "logo_file_id" FROM "brand_kits" WHERE "logo_file_id" IS NOT NULL
ON CONFLICT ("org_id") DO NOTHING;

CREATE TYPE "public"."document_kind" AS ENUM('proposal', 'quotation', 'minutes');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('draft', 'final');--> statement-breakpoint
CREATE TABLE "document_items" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"document_id" text NOT NULL,
	"position" integer NOT NULL,
	"package_id" text,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" bigint NOT NULL,
	"line_total" bigint NOT NULL,
	CONSTRAINT "document_items_quantity_ck" CHECK ("document_items"."quantity" > 0),
	CONSTRAINT "document_items_amounts_ck" CHECK ("document_items"."unit_price" >= 0 and "document_items"."line_total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"kind" "document_kind" NOT NULL,
	"series_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "document_status" DEFAULT 'draft' NOT NULL,
	"number" text,
	"title" text NOT NULL,
	"client_id" text,
	"lead_id" text,
	"meeting_id" text,
	"narrative" text,
	"subtotal" bigint DEFAULT 0 NOT NULL,
	"tax_rate_bps" integer DEFAULT 0 NOT NULL,
	"tax_amount" bigint DEFAULT 0 NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL,
	"valid_until" date,
	"is_ai_draft" boolean DEFAULT false NOT NULL,
	"finalized_at" timestamp with time zone,
	"finalized_by" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_documents_org_id" UNIQUE("org_id","id"),
	CONSTRAINT "uq_documents_series_version" UNIQUE("series_id","version"),
	CONSTRAINT "uq_documents_number" UNIQUE("org_id","number"),
	CONSTRAINT "documents_amounts_ck" CHECK ("documents"."subtotal" >= 0 and "documents"."tax_amount" >= 0 and "documents"."total" >= 0 and "documents"."tax_rate_bps" >= 0),
	CONSTRAINT "documents_version_ck" CHECK ("documents"."version" >= 1),
	CONSTRAINT "documents_final_ck" CHECK (("documents"."status" = 'final') = ("documents"."finalized_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "document_items" ADD CONSTRAINT "fk_document_items_document" FOREIGN KEY ("org_id","document_id") REFERENCES "public"."documents"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_items" ADD CONSTRAINT "fk_document_items_package" FOREIGN KEY ("org_id","package_id") REFERENCES "public"."packages"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "fk_documents_client" FOREIGN KEY ("org_id","client_id") REFERENCES "public"."clients"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "fk_documents_lead" FOREIGN KEY ("org_id","lead_id") REFERENCES "public"."leads"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "fk_documents_meeting" FOREIGN KEY ("org_id","meeting_id") REFERENCES "public"."meetings"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "fk_documents_finalized_by" FOREIGN KEY ("org_id","finalized_by") REFERENCES "public"."users"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_documents_kind" ON "documents" USING btree ("org_id","kind","created_at");
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'sent', 'paid', 'void');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('payment', 'correction');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'stopped');--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"position" smallint NOT NULL,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" bigint NOT NULL,
	"line_total" bigint NOT NULL,
	CONSTRAINT "uq_invoice_items_position" UNIQUE("invoice_id","position"),
	CONSTRAINT "invoice_items_ck" CHECK ("invoice_items"."quantity" > 0 and "invoice_items"."unit_price" >= 0 and "invoice_items"."line_total" = "invoice_items"."quantity" * "invoice_items"."unit_price")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text NOT NULL,
	"subscription_id" text,
	"period_key" text,
	"number" text,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"issue_date" date,
	"due_date" date NOT NULL,
	"subtotal" bigint DEFAULT 0 NOT NULL,
	"tax_amount" bigint DEFAULT 0 NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL,
	"tax_rate_bps" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"is_ai_draft" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_invoices_org_id" UNIQUE("org_id","id"),
	CONSTRAINT "uq_invoices_number" UNIQUE("org_id","number"),
	CONSTRAINT "invoices_amounts_ck" CHECK ("invoices"."subtotal" >= 0 and "invoices"."tax_amount" >= 0 and "invoices"."total" >= 0 and "invoices"."total" = "invoices"."subtotal" + "invoices"."tax_amount"),
	CONSTRAINT "invoices_tax_rate_ck" CHECK ("invoices"."tax_rate_bps" between 0 and 10000),
	CONSTRAINT "invoices_number_ck" CHECK ("invoices"."status" in ('draft', 'void') or "invoices"."number" is not null),
	CONSTRAINT "invoices_void_reason_ck" CHECK ("invoices"."status" <> 'void' or "invoices"."void_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "number_counters" (
	"org_id" text NOT NULL,
	"scope" text NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pk_number_counters" PRIMARY KEY("org_id","scope")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"kind" "payment_kind" DEFAULT 'payment' NOT NULL,
	"amount" bigint NOT NULL,
	"paid_on" date NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"note" text,
	"recorded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_ck" CHECK ("payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text NOT NULL,
	"product_id" text NOT NULL,
	"package_id" text NOT NULL,
	"deployment_id" text,
	"amount" bigint NOT NULL,
	"interval_months" smallint DEFAULT 1 NOT NULL,
	"next_due_date" date NOT NULL,
	"grace_days" smallint,
	"status" "subscription_status" DEFAULT 'active' NOT NULL,
	"started_on" date NOT NULL,
	"stopped_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_subscriptions_org_id" UNIQUE("org_id","id"),
	CONSTRAINT "subscriptions_amount_ck" CHECK ("subscriptions"."amount" >= 0),
	CONSTRAINT "subscriptions_interval_ck" CHECK ("subscriptions"."interval_months" > 0),
	CONSTRAINT "subscriptions_grace_ck" CHECK ("subscriptions"."grace_days" is null or "subscriptions"."grace_days" >= 0),
	CONSTRAINT "subscriptions_stopped_ck" CHECK (("subscriptions"."status" = 'stopped') = ("subscriptions"."stopped_on" is not null))
);
--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "fk_invoice_items_invoice" FOREIGN KEY ("org_id","invoice_id") REFERENCES "public"."invoices"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "fk_invoices_client" FOREIGN KEY ("org_id","client_id") REFERENCES "public"."clients"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "fk_invoices_subscription" FOREIGN KEY ("org_id","subscription_id") REFERENCES "public"."subscriptions"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_counters" ADD CONSTRAINT "number_counters_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "fk_payments_invoice" FOREIGN KEY ("org_id","invoice_id") REFERENCES "public"."invoices"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "fk_subscriptions_client" FOREIGN KEY ("org_id","client_id") REFERENCES "public"."clients"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "fk_subscriptions_product" FOREIGN KEY ("org_id","product_id") REFERENCES "public"."products"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "fk_subscriptions_package" FOREIGN KEY ("org_id","package_id") REFERENCES "public"."packages"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "fk_subscriptions_deployment" FOREIGN KEY ("org_id","deployment_id") REFERENCES "public"."deployments"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_invoices_period" ON "invoices" USING btree ("subscription_id","period_key") WHERE "invoices"."subscription_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_invoices_due" ON "invoices" USING btree ("org_id","status","due_date");--> statement-breakpoint
CREATE INDEX "idx_invoices_client" ON "invoices" USING btree ("org_id","client_id");--> statement-breakpoint
CREATE INDEX "idx_payments_invoice" ON "payments" USING btree ("org_id","invoice_id");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_due" ON "subscriptions" USING btree ("org_id","status","next_due_date");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_client" ON "subscriptions" USING btree ("org_id","client_id");
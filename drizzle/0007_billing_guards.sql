-- Guards for billing (ERD section 5). Payments are append-only (BR-M03-06) and an invoice's content is locked once it
-- leaves `draft` (BR-M03-04). Money rules must not depend on application code alone.
CREATE TRIGGER payments_append_only
  BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER payments_no_truncate
  BEFORE TRUNCATE ON payments
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_invoice_content() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'draft' AND (
       NEW.client_id IS DISTINCT FROM OLD.client_id
    OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id
    OR NEW.period_key IS DISTINCT FROM OLD.period_key
    OR NEW.number IS DISTINCT FROM OLD.number
    OR NEW.issue_date IS DISTINCT FROM OLD.issue_date
    OR NEW.due_date IS DISTINCT FROM OLD.due_date
    OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
    OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount
    OR NEW.total IS DISTINCT FROM OLD.total
    OR NEW.tax_rate_bps IS DISTINCT FROM OLD.tax_rate_bps
    OR NEW.notes IS DISTINCT FROM OLD.notes
  ) THEN
    RAISE EXCEPTION 'invoice % is % and its content can no longer change', OLD.id, OLD.status
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER invoices_lock_content
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION guard_invoice_content();
--> statement-breakpoint
-- Sent, paid and void invoices cannot be deleted at all; a draft may be (its items go first).
CREATE OR REPLACE FUNCTION guard_invoice_delete() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'invoice % is % and cannot be deleted', OLD.id, OLD.status USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER invoices_no_delete
  BEFORE DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION guard_invoice_delete();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_invoice_items() RETURNS trigger AS $$
DECLARE
  parent_status invoice_status;
  parent_org text;
  parent_id text;
BEGIN
  parent_org := COALESCE(NEW.org_id, OLD.org_id);
  parent_id := COALESCE(NEW.invoice_id, OLD.invoice_id);
  SELECT status INTO parent_status FROM invoices WHERE org_id = parent_org AND id = parent_id;
  IF parent_status IS NOT NULL AND parent_status <> 'draft' THEN
    RAISE EXCEPTION 'items of invoice % cannot change: it is %', parent_id, parent_status USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER invoice_items_lock
  BEFORE INSERT OR UPDATE OR DELETE ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION guard_invoice_items();

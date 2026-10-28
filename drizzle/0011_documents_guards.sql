-- Guards for documents (ERD 3.5 and section 5). A final document never changes: a revision is a new row in the same
-- series (BRD-M06). Only the move from draft to final itself may touch a draft's status, number and finalization stamp.
CREATE OR REPLACE FUNCTION guard_document_final() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'final' THEN
    RAISE EXCEPTION 'document % is final and can no longer change', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER documents_lock_final
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION guard_document_final();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_document_item_final() RETURNS trigger AS $$
DECLARE
  doc_status document_status;
BEGIN
  SELECT status INTO doc_status FROM documents WHERE org_id = COALESCE(NEW.org_id, OLD.org_id) AND id = COALESCE(NEW.document_id, OLD.document_id);
  IF doc_status = 'final' THEN
    RAISE EXCEPTION 'the items of a final document can no longer change'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER document_items_lock_final
  BEFORE INSERT OR UPDATE OR DELETE ON document_items
  FOR EACH ROW EXECUTE FUNCTION guard_document_item_final();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_document_delete() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'final' THEN
    RAISE EXCEPTION 'final document % cannot be deleted', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER documents_no_delete_final
  BEFORE DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION guard_document_delete();
--> statement-breakpoint
-- The meetings/documents cycle (ERD section 4): the minutes link is added once both tables exist.
ALTER TABLE "meetings" ADD CONSTRAINT "fk_meetings_minutes_document" FOREIGN KEY ("org_id","minutes_document_id") REFERENCES "public"."documents"("org_id","id") ON DELETE no action ON UPDATE no action;

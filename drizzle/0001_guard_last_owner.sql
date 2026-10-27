-- Guard (ERD section 5, BR-M01-03): an organization can never be left without an active owner.
-- Blocks demoting, deactivating, moving or deleting the last active owner, even from a buggy service.
CREATE OR REPLACE FUNCTION guard_last_owner() RETURNS trigger AS $$
BEGIN
  IF OLD.role = 'owner' AND OLD.is_active
     AND (TG_OP = 'DELETE' OR NEW.role <> 'owner' OR NEW.is_active = false OR NEW.org_id <> OLD.org_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM users
      WHERE org_id = OLD.org_id AND role = 'owner' AND is_active AND id <> OLD.id
    ) THEN
      RAISE EXCEPTION 'organization % must keep at least one active owner', OLD.org_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER users_guard_last_owner
  BEFORE UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION guard_last_owner();

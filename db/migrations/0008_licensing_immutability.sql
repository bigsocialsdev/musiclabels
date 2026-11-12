-- Insert-only tables (CLAUDE.md: license_terms_versions; price grids and license history likewise).
SELECT mrm_append_only('license_terms_versions');
--> statement-breakpoint
SELECT mrm_append_only('price_book_entries');
--> statement-breakpoint
SELECT mrm_append_only('license_events');
--> statement-breakpoint

-- Licenses: never deleted; every column except the status fields is immutable, which covers the record-hash
-- inputs. Status may only move active -> expired | revoked (PLAN 4.4), and expired only once ends_at has
-- passed (database time; the app uses now() too, so clocks cannot disagree). A column added later is immutable
-- unless it is added to the exclusion list below.
CREATE FUNCTION mrm_licenses_guard_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (to_jsonb(NEW) - 'status' - 'revoked_reason' - 'revoked_at' - 'updated_at')
     IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'revoked_reason' - 'revoked_at' - 'updated_at') THEN
    RAISE EXCEPTION 'licenses: only status fields may change'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'active' AND NEW.status IN ('expired', 'revoked')) THEN
    RAISE EXCEPTION 'licenses: status % -> % is not allowed', OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status = 'expired' AND OLD.status = 'active' AND (OLD.ends_at IS NULL OR OLD.ends_at > now()) THEN
    RAISE EXCEPTION 'licenses: only a fixed-term license past ends_at can expire'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status = OLD.status AND (NEW.revoked_reason IS DISTINCT FROM OLD.revoked_reason
                                  OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'licenses: revocation fields are set only by the revoke transition'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER licenses_guard_update BEFORE UPDATE ON public.licenses
  FOR EACH ROW EXECUTE FUNCTION public.mrm_licenses_guard_update();
--> statement-breakpoint

-- Rows a license (or an order) points at are never hard-deleted.
CREATE TRIGGER licenses_no_delete BEFORE DELETE ON public.licenses
  FOR EACH ROW EXECUTE FUNCTION public.mrm_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER licenses_no_truncate BEFORE TRUNCATE ON public.licenses
  FOR EACH STATEMENT EXECUTE FUNCTION public.mrm_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER licensed_channels_no_delete BEFORE DELETE ON public.licensed_channels
  FOR EACH ROW EXECUTE FUNCTION public.mrm_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER licensed_channels_no_truncate BEFORE TRUNCATE ON public.licensed_channels
  FOR EACH STATEMENT EXECUTE FUNCTION public.mrm_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER licensed_videos_no_delete BEFORE DELETE ON public.licensed_videos
  FOR EACH ROW EXECUTE FUNCTION public.mrm_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER licensed_videos_no_truncate BEFORE TRUNCATE ON public.licensed_videos
  FOR EACH STATEMENT EXECUTE FUNCTION public.mrm_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER price_books_no_delete BEFORE DELETE ON public.price_books
  FOR EACH ROW EXECUTE FUNCTION public.mrm_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER price_books_no_truncate BEFORE TRUNCATE ON public.price_books
  FOR EACH STATEMENT EXECUTE FUNCTION public.mrm_forbid_mutation();

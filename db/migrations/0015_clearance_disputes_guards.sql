-- Dispute history is insert-only (CLAUDE.md: dispute_events).
SELECT mrm_append_only('dispute_events');
--> statement-breakpoint

-- Clearance requests (PLAN 4.5): identity columns never change; status moves only along the diagram;
-- responded_at is write-once. A request is closed by completed or failed.
CREATE FUNCTION mrm_clearance_requests_guard_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  mutable text[] := array['status','respond_token_hash','token_expires_at','due_at','sent_at','responded_at','seller_note','evidence_key','external_ref','last_error','updated_at'];
BEGIN
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'clearance_requests: only status and response fields may change' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  PERFORM public.mrm_write_once('clearance_requests.responded_at', OLD.responded_at::text, NEW.responded_at::text);
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status || '>' || NEW.status = ANY (array[
      'pending>sent', 'sent>completed', 'sent>failed', 'sent>overdue',
      'overdue>completed', 'overdue>failed', 'overdue>escalated',
      'escalated>completed', 'escalated>failed'])) THEN
    RAISE EXCEPTION 'clearance_requests: status % -> % is not allowed', OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER clearance_requests_guard_update BEFORE UPDATE ON public.clearance_requests
  FOR EACH ROW EXECUTE FUNCTION public.mrm_clearance_requests_guard_update();
--> statement-breakpoint
CREATE TRIGGER clearance_requests_no_delete BEFORE DELETE ON public.clearance_requests FOR EACH ROW EXECUTE FUNCTION public.mrm_forbid_mutation();
--> statement-breakpoint

-- Disputes (PLAN 4.6): what the buyer reported and the timers fixed at open never change; status moves only
-- along the diagram (a kit-issued dispute can still become refund-eligible on its window).
CREATE FUNCTION mrm_disputes_guard_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  mutable text[] := array['status','claimant_cataloged','overdue_notified_at','resolution','closed_at','updated_at'];
BEGIN
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'disputes: the reported facts and timers are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status || '>' || NEW.status = ANY (array[
      'open>in_progress', 'in_progress>resolved_released', 'in_progress>resolved_denied',
      'in_progress>refund_eligible', 'in_progress>resolved_kit_issued',
      'resolved_kit_issued>refund_eligible', 'refund_eligible>resolved_refunded'])) THEN
    RAISE EXCEPTION 'disputes: status % -> % is not allowed', OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER disputes_guard_update BEFORE UPDATE ON public.disputes
  FOR EACH ROW EXECUTE FUNCTION public.mrm_disputes_guard_update();
--> statement-breakpoint
CREATE TRIGGER disputes_no_delete BEFORE DELETE ON public.disputes FOR EACH ROW EXECUTE FUNCTION public.mrm_forbid_mutation();
--> statement-breakpoint

-- Copyright complaints: what was complained about never changes; status moves forward only.
CREATE FUNCTION mrm_copyright_complaints_guard_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  mutable text[] := array['status','grievance_officer_id','outcome_note','acknowledged_at','closed_at'];
BEGIN
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'copyright_complaints: the complaint itself is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status || '>' || NEW.status = ANY (array[
      'received>investigating', 'received>rejected', 'investigating>upheld', 'investigating>rejected'])) THEN
    RAISE EXCEPTION 'copyright_complaints: status % -> % is not allowed', OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER copyright_complaints_guard_update BEFORE UPDATE ON public.copyright_complaints
  FOR EACH ROW EXECUTE FUNCTION public.mrm_copyright_complaints_guard_update();
--> statement-breakpoint
CREATE TRIGGER copyright_complaints_no_delete BEFORE DELETE ON public.copyright_complaints FOR EACH ROW EXECUTE FUNCTION public.mrm_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER enquiries_no_delete BEFORE DELETE ON public.enquiries FOR EACH ROW EXECUTE FUNCTION public.mrm_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER channel_verifications_no_delete BEFORE DELETE ON public.channel_verifications FOR EACH ROW EXECUTE FUNCTION public.mrm_forbid_mutation();

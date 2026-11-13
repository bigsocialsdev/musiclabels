-- A dispute ops never acted on (still `open`) becomes refund-eligible when its 48-hour resolution deadline passes
-- (protects the buyer from an ops failure). Same guard as 0015 plus `open>refund_eligible`.
CREATE OR REPLACE FUNCTION mrm_disputes_guard_update() RETURNS trigger
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
      'open>in_progress', 'open>refund_eligible', 'in_progress>resolved_released', 'in_progress>resolved_denied',
      'in_progress>refund_eligible', 'in_progress>resolved_kit_issued',
      'resolved_kit_issued>refund_eligible', 'refund_eligible>resolved_refunded'])) THEN
    RAISE EXCEPTION 'disputes: status % -> % is not allowed', OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;

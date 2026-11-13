-- Refunds: full refunds only (amount = the order's total), one per order; status forward only
-- (requested -> processing -> processed | failed, failed -> processing for a retry).
CREATE FUNCTION mrm_refunds_guard_insert() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  order_total bigint;
BEGIN
  SELECT total_paise INTO order_total FROM public.orders WHERE id = NEW.order_id;
  IF NEW.amount_paise IS DISTINCT FROM order_total THEN
    RAISE EXCEPTION 'refunds: amount must equal the order total (full refunds only)'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER refunds_guard_insert BEFORE INSERT ON public.refunds
  FOR EACH ROW EXECUTE FUNCTION public.mrm_refunds_guard_insert();
--> statement-breakpoint
CREATE FUNCTION mrm_refunds_guard_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  mutable text[] := array['status','gateway_refund_id','claimed_at','last_error','processed_at','updated_at'];
BEGIN
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'refunds: only status fields may change' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  -- gateway_refund_id may be replaced by a retry after a failed attempt; the receipt (our row id) is the key.
  IF NEW.gateway_refund_id IS DISTINCT FROM OLD.gateway_refund_id AND OLD.status = 'processed' THEN
    RAISE EXCEPTION 'refunds: a processed refund keeps its gateway id' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  PERFORM public.mrm_write_once('refunds.processed_at', OLD.processed_at::text, NEW.processed_at::text);
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status || '>' || NEW.status = ANY (array[
      'requested>processing', 'processing>processed', 'processing>failed', 'failed>processing'])) THEN
    RAISE EXCEPTION 'refunds: status % -> % is not allowed', OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER refunds_guard_update BEFORE UPDATE ON public.refunds
  FOR EACH ROW EXECUTE FUNCTION public.mrm_refunds_guard_update();
--> statement-breakpoint

-- Credit notes: immutable like invoices; pdf_key write-once.
CREATE FUNCTION mrm_credit_notes_guard_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (to_jsonb(NEW) - 'pdf_key') IS DISTINCT FROM (to_jsonb(OLD) - 'pdf_key') THEN
    RAISE EXCEPTION 'credit_notes: issued credit notes are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  PERFORM public.mrm_write_once('credit_notes.pdf_key', OLD.pdf_key, NEW.pdf_key);
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER credit_notes_guard_update BEFORE UPDATE ON public.credit_notes
  FOR EACH ROW EXECUTE FUNCTION public.mrm_credit_notes_guard_update();
--> statement-breakpoint

-- Chargebacks: open -> won | lost, decided once.
CREATE FUNCTION mrm_chargebacks_guard_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (to_jsonb(NEW) - array['status','updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - array['status','updated_at'])
     OR (NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'open' AND NEW.status IN ('won', 'lost'))) THEN
    RAISE EXCEPTION 'chargebacks: only open -> won | lost' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER chargebacks_guard_update BEFORE UPDATE ON public.chargebacks
  FOR EACH ROW EXECUTE FUNCTION public.mrm_chargebacks_guard_update();
--> statement-breakpoint

-- Payouts: amounts fixed at compute; status pending -> processing -> paid | failed (pending -> failed drops a
-- line from its batch); utr and paid_at write-once.
CREATE FUNCTION mrm_payouts_guard_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  mutable text[] := array['status','rail_ref','utr','failure_reason','statement_pdf_key','paid_at','updated_at'];
BEGIN
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'payouts: amounts are fixed once computed' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  PERFORM public.mrm_write_once('payouts.utr', OLD.utr, NEW.utr);
  PERFORM public.mrm_write_once('payouts.paid_at', OLD.paid_at::text, NEW.paid_at::text);
  PERFORM public.mrm_write_once('payouts.statement_pdf_key', OLD.statement_pdf_key, NEW.statement_pdf_key);
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status || '>' || NEW.status = ANY (array[
      'pending>processing', 'pending>failed', 'processing>paid', 'processing>failed'])) THEN
    RAISE EXCEPTION 'payouts: status % -> % is not allowed', OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER payouts_guard_update BEFORE UPDATE ON public.payouts
  FOR EACH ROW EXECUTE FUNCTION public.mrm_payouts_guard_update();
--> statement-breakpoint
CREATE FUNCTION mrm_payout_batches_guard_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.period IS DISTINCT FROM OLD.period OR NEW.cutoff_at IS DISTINCT FROM OLD.cutoff_at
     OR (NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status || '>' || NEW.status = ANY (array[
      'draft>computed', 'computed>approved', 'approved>processing', 'processing>completed']))) THEN
    RAISE EXCEPTION 'payout_batches: % -> % is not allowed', OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER payout_batches_guard_update BEFORE UPDATE ON public.payout_batches
  FOR EACH ROW EXECUTE FUNCTION public.mrm_payout_batches_guard_update();
--> statement-breakpoint

-- Never hard-deleted.
CREATE TRIGGER refunds_no_delete BEFORE DELETE ON public.refunds FOR EACH ROW EXECUTE FUNCTION public.mrm_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER credit_notes_no_delete BEFORE DELETE ON public.credit_notes FOR EACH ROW EXECUTE FUNCTION public.mrm_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER credit_notes_no_truncate BEFORE TRUNCATE ON public.credit_notes FOR EACH STATEMENT EXECUTE FUNCTION public.mrm_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER chargebacks_no_delete BEFORE DELETE ON public.chargebacks FOR EACH ROW EXECUTE FUNCTION public.mrm_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER payouts_no_delete BEFORE DELETE ON public.payouts FOR EACH ROW EXECUTE FUNCTION public.mrm_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER payout_batches_no_delete BEFORE DELETE ON public.payout_batches FOR EACH ROW EXECUTE FUNCTION public.mrm_forbid_mutation();

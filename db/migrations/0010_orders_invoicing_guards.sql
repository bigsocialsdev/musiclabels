-- Insert-only tables (CLAUDE.md: order_events, ledger_entries; certificate revisions and download logs likewise).
SELECT mrm_append_only('order_events');
--> statement-breakpoint
SELECT mrm_append_only('ledger_entries');
--> statement-breakpoint
SELECT mrm_append_only('certificates');
--> statement-breakpoint
SELECT mrm_append_only('license_downloads');
--> statement-breakpoint

-- Write-once helper: raise unless the column was null or is unchanged.
CREATE FUNCTION mrm_write_once(col text, old_v text, new_v text) RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF old_v IS NOT NULL AND new_v IS DISTINCT FROM old_v THEN
    RAISE EXCEPTION '% is write-once', col USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END
$$;
--> statement-breakpoint

-- Orders: the snapshot (money, track, terms, buyer facts) never changes; gateway ids and timestamps are
-- write-once; status moves only along PLAN 4.3 (plus failed -> paid, a capture after a failed attempt).
CREATE FUNCTION mrm_orders_guard_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  mutable text[] := array['status','gateway_order_id','gateway_payment_id','paid_at','fulfilled_at',
                          'fulfil_claimed_at','fulfil_attempts','last_error','updated_at'];
BEGIN
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'orders: the snapshot is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  PERFORM public.mrm_write_once('orders.gateway_order_id', OLD.gateway_order_id, NEW.gateway_order_id);
  PERFORM public.mrm_write_once('orders.gateway_payment_id', OLD.gateway_payment_id, NEW.gateway_payment_id);
  PERFORM public.mrm_write_once('orders.paid_at', OLD.paid_at::text, NEW.paid_at::text);
  PERFORM public.mrm_write_once('orders.fulfilled_at', OLD.fulfilled_at::text, NEW.fulfilled_at::text);
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status || '>' || NEW.status = ANY (array[
      'created>awaiting_payment', 'awaiting_payment>paid', 'awaiting_payment>failed', 'awaiting_payment>expired',
      'failed>paid', 'expired>paid', 'paid>fulfilled', 'paid>refund_pending', 'fulfilled>refund_pending',
      'refund_pending>refunded', 'fulfilled>charged_back_pending', 'charged_back_pending>fulfilled',
      'charged_back_pending>charged_back'])) THEN
    RAISE EXCEPTION 'orders: status % -> % is not allowed', OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status = 'paid' AND OLD.status <> 'paid' AND (NEW.gateway_payment_id IS NULL OR NEW.paid_at IS NULL) THEN
    RAISE EXCEPTION 'orders: paid needs a payment id and paid_at' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER orders_guard_update BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.mrm_orders_guard_update();
--> statement-breakpoint

-- payment_events only gains processed_at (CLAUDE.md).
CREATE FUNCTION mrm_payment_events_guard_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (to_jsonb(NEW) - 'processed_at') IS DISTINCT FROM (to_jsonb(OLD) - 'processed_at') OR OLD.processed_at IS NOT NULL THEN
    RAISE EXCEPTION 'payment_events: only processed_at may be set, once' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER payment_events_guard_update BEFORE UPDATE ON public.payment_events
  FOR EACH ROW EXECUTE FUNCTION public.mrm_payment_events_guard_update();
--> statement-breakpoint

-- Issued invoices are immutable for every fiscal column; pdf_key and the e-invoice fields are write-once.
CREATE FUNCTION mrm_invoices_guard_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  write_once text[] := array['pdf_key','irn','irn_ack_no','signed_qr'];
BEGIN
  IF (to_jsonb(NEW) - write_once) IS DISTINCT FROM (to_jsonb(OLD) - write_once) THEN
    RAISE EXCEPTION 'invoices: issued invoices are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  PERFORM public.mrm_write_once('invoices.pdf_key', OLD.pdf_key, NEW.pdf_key);
  PERFORM public.mrm_write_once('invoices.irn', OLD.irn, NEW.irn);
  PERFORM public.mrm_write_once('invoices.irn_ack_no', OLD.irn_ack_no, NEW.irn_ack_no);
  PERFORM public.mrm_write_once('invoices.signed_qr', OLD.signed_qr, NEW.signed_qr);
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER invoices_guard_update BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.mrm_invoices_guard_update();
--> statement-breakpoint

-- Invoice counters only step forward by one, so an allocated number is never reused or skipped.
CREATE FUNCTION mrm_invoice_series_guard_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.fy IS DISTINCT FROM OLD.fy OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.next_number <> OLD.next_number + 1 THEN
    RAISE EXCEPTION 'invoice_series: counters only advance by one' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER invoice_series_guard_update BEFORE UPDATE ON public.invoice_series
  FOR EACH ROW EXECUTE FUNCTION public.mrm_invoice_series_guard_update();
--> statement-breakpoint

-- Never hard-deleted: orders, payment events, invoices, counters (and everything above via append-only).
CREATE TRIGGER orders_no_delete BEFORE DELETE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.mrm_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER orders_no_truncate BEFORE TRUNCATE ON public.orders FOR EACH STATEMENT EXECUTE FUNCTION public.mrm_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER payment_events_no_delete BEFORE DELETE ON public.payment_events FOR EACH ROW EXECUTE FUNCTION public.mrm_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER payment_events_no_truncate BEFORE TRUNCATE ON public.payment_events FOR EACH STATEMENT EXECUTE FUNCTION public.mrm_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER invoices_no_delete BEFORE DELETE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.mrm_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER invoices_no_truncate BEFORE TRUNCATE ON public.invoices FOR EACH STATEMENT EXECUTE FUNCTION public.mrm_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER invoice_series_no_delete BEFORE DELETE ON public.invoice_series FOR EACH ROW EXECUTE FUNCTION public.mrm_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER invoice_series_no_truncate BEFORE TRUNCATE ON public.invoice_series FOR EACH STATEMENT EXECUTE FUNCTION public.mrm_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER reconciliation_items_no_delete BEFORE DELETE ON public.reconciliation_items FOR EACH ROW EXECUTE FUNCTION public.mrm_forbid_mutation();

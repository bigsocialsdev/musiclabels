-- Append-only enforcement (CLAUDE.md: audit_log, acceptances, ledger_entries, order_events, ...).
-- Later migrations make a table append-only with:  SELECT mrm_append_only('table_name');

CREATE FUNCTION mrm_forbid_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: table is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END
$$;
--> statement-breakpoint
CREATE FUNCTION mrm_append_only(tbl text) RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  EXECUTE format(
    'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.mrm_forbid_mutation()',
    tbl || '_append_only_row', tbl);
  EXECUTE format(
    'CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.mrm_forbid_mutation()',
    tbl || '_append_only_truncate', tbl);
END
$$;
--> statement-breakpoint
SELECT mrm_append_only('audit_log');

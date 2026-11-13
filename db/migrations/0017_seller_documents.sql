CREATE TABLE "seller_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seller_org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"declared_mime" text NOT NULL,
	"file_key" text NOT NULL,
	"size_bytes" bigint,
	"validation_status" text DEFAULT 'pending' NOT NULL,
	"validation_error" text,
	"uploaded_by" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_documents_kind_check" CHECK ("seller_documents"."kind" in ('pan_card','id_proof','gst_certificate','bank_proof')),
	CONSTRAINT "seller_documents_validation_status_check" CHECK ("seller_documents"."validation_status" in ('pending','valid','rejected'))
);
--> statement-breakpoint
ALTER TABLE "seller_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seller_documents" ADD CONSTRAINT "seller_documents_seller_org_id_organizations_id_fk" FOREIGN KEY ("seller_org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_documents" ADD CONSTRAINT "seller_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "seller_documents_org_idx" ON "seller_documents" USING btree ("seller_org_id","uploaded_at");
--> statement-breakpoint
-- A KYC document is never deleted and its identity never changes; only the validation result is written.
CREATE FUNCTION mrm_seller_documents_guard_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  mutable text[] := array['validation_status','validation_error','size_bytes'];
BEGIN
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'seller_documents: only the validation result can change' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER seller_documents_guard_update BEFORE UPDATE ON public.seller_documents
  FOR EACH ROW EXECUTE FUNCTION public.mrm_seller_documents_guard_update();
--> statement-breakpoint
CREATE TRIGGER seller_documents_no_delete BEFORE DELETE ON public.seller_documents FOR EACH ROW EXECUTE FUNCTION public.mrm_forbid_mutation();

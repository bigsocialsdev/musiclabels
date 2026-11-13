CREATE TABLE "chargebacks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"gateway_dispute_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"amount_paise" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chargebacks_gateway_dispute_id_unique" UNIQUE("gateway_dispute_id"),
	CONSTRAINT "chargebacks_status_check" CHECK ("chargebacks"."status" in ('open','won','lost'))
);
--> statement-breakpoint
ALTER TABLE "chargebacks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invoice_id" uuid NOT NULL,
	"refund_id" uuid NOT NULL,
	"number" text NOT NULL,
	"fy" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"taxable_paise" bigint NOT NULL,
	"cgst_paise" bigint NOT NULL,
	"sgst_paise" bigint NOT NULL,
	"igst_paise" bigint NOT NULL,
	"total_paise" bigint NOT NULL,
	"pdf_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_notes_invoice_id_unique" UNIQUE("invoice_id"),
	CONSTRAINT "credit_notes_refund_id_unique" UNIQUE("refund_id"),
	CONSTRAINT "credit_notes_number_unique" UNIQUE("number"),
	CONSTRAINT "credit_notes_number_length_check" CHECK (char_length("credit_notes"."number") <= 16),
	CONSTRAINT "credit_notes_total_check" CHECK ("credit_notes"."total_paise" = "credit_notes"."taxable_paise" + "credit_notes"."cgst_paise" + "credit_notes"."sgst_paise" + "credit_notes"."igst_paise")
);
--> statement-breakpoint
ALTER TABLE "credit_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payout_accounts" (
	"seller_org_id" uuid PRIMARY KEY NOT NULL,
	"account_number_encrypted" text NOT NULL,
	"ifsc" text NOT NULL,
	"account_holder_name" text NOT NULL,
	"name_match_status" text DEFAULT 'unchecked' NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"rail_ref" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payout_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payout_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"period" text NOT NULL,
	"cutoff_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"rail_file_key" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_batches_period_unique" UNIQUE("period"),
	CONSTRAINT "payout_batches_status_check" CHECK ("payout_batches"."status" in ('draft','computed','approved','processing','completed')),
	CONSTRAINT "payout_batches_period_check" CHECK ("payout_batches"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
ALTER TABLE "payout_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"seller_org_id" uuid NOT NULL,
	"royalty_base_paise" bigint NOT NULL,
	"tds_paise" bigint NOT NULL,
	"seller_gst_paise" bigint NOT NULL,
	"rcm_gst_paise" bigint NOT NULL,
	"net_paise" bigint NOT NULL,
	"rail" text NOT NULL,
	"rail_ref" text,
	"utr" text,
	"failure_reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"statement_pdf_key" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payouts_batch_seller_key" UNIQUE("batch_id","seller_org_id"),
	CONSTRAINT "payouts_status_check" CHECK ("payouts"."status" in ('pending','processing','paid','failed')),
	CONSTRAINT "payouts_rail_check" CHECK ("payouts"."rail" in ('bank_file','razorpayx')),
	CONSTRAINT "payouts_amounts_check" CHECK ("payouts"."royalty_base_paise" > 0 and "payouts"."tds_paise" >= 0 and "payouts"."seller_gst_paise" >= 0 and "payouts"."rcm_gst_paise" >= 0),
	CONSTRAINT "payouts_net_check" CHECK ("payouts"."net_paise" = "payouts"."royalty_base_paise" - "payouts"."tds_paise" + "payouts"."seller_gst_paise")
);
--> statement-breakpoint
ALTER TABLE "payouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"gateway_refund_id" text,
	"status" text DEFAULT 'requested' NOT NULL,
	"note" text,
	"requested_by" uuid,
	"claimed_at" timestamp with time zone,
	"last_error" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "refunds_gateway_refund_id_unique" UNIQUE("gateway_refund_id"),
	CONSTRAINT "refunds_reason_check" CHECK ("refunds"."reason" in ('claim_not_released','platform_error','invalid_rights','unsellable_at_fulfilment','admin_goodwill')),
	CONSTRAINT "refunds_status_check" CHECK ("refunds"."status" in ('requested','processing','processed','failed')),
	CONSTRAINT "refunds_amount_check" CHECK ("refunds"."amount_paise" > 0)
);
--> statement-breakpoint
ALTER TABLE "refunds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chargebacks" ADD CONSTRAINT "chargebacks_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_accounts" ADD CONSTRAINT "payout_accounts_seller_org_id_organizations_id_fk" FOREIGN KEY ("seller_org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_accounts" ADD CONSTRAINT "payout_accounts_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_batches" ADD CONSTRAINT "payout_batches_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_batch_id_payout_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."payout_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_seller_org_id_organizations_id_fk" FOREIGN KEY ("seller_org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refunds_status_idx" ON "refunds" USING btree ("status");--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_payout_key" ON "ledger_entries" USING btree ("payout_id") WHERE "ledger_entries"."kind" = 'payout';--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payout_check" CHECK (("ledger_entries"."kind" = 'payout') = ("ledger_entries"."payout_id" is not null));--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_sign_check" CHECK (("ledger_entries"."kind" = 'sale_royalty' and "ledger_entries"."amount_paise" >= 0) or ("ledger_entries"."kind" in ('refund_reversal','chargeback_reversal','clawback','payout') and "ledger_entries"."amount_paise" <= 0) or "ledger_entries"."kind" = 'adjustment');
CREATE TABLE "certificates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"license_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"pdf_key" text NOT NULL,
	"pdf_sha256" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certificates_license_revision_key" UNIQUE("license_id","revision")
);
--> statement-breakpoint
ALTER TABLE "certificates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoice_series" (
	"fy" text NOT NULL,
	"kind" text NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "invoice_series_fy_kind_pk" PRIMARY KEY("fy","kind"),
	CONSTRAINT "invoice_series_kind_check" CHECK ("invoice_series"."kind" in ('invoice','credit_note')),
	CONSTRAINT "invoice_series_fy_check" CHECK ("invoice_series"."fy" ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
ALTER TABLE "invoice_series" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"number" text NOT NULL,
	"fy" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"supplier_gstin" text NOT NULL,
	"supplier_state_code" text NOT NULL,
	"recipient_name" text NOT NULL,
	"recipient_gstin" text,
	"recipient_state_code" text NOT NULL,
	"recipient_address" text,
	"place_of_supply_state" text NOT NULL,
	"sac_code" text NOT NULL,
	"gst_rate_bps" integer NOT NULL,
	"taxable_paise" bigint NOT NULL,
	"cgst_paise" bigint NOT NULL,
	"sgst_paise" bigint NOT NULL,
	"igst_paise" bigint NOT NULL,
	"total_paise" bigint NOT NULL,
	"line_description" text NOT NULL,
	"pdf_key" text,
	"irn" text,
	"irn_ack_no" text,
	"signed_qr" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "invoices_number_unique" UNIQUE("number"),
	CONSTRAINT "invoices_number_length_check" CHECK (char_length("invoices"."number") <= 16),
	CONSTRAINT "invoices_total_check" CHECK ("invoices"."total_paise" = "invoices"."taxable_paise" + "invoices"."cgst_paise" + "invoices"."sgst_paise" + "invoices"."igst_paise")
);
--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seller_org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"order_id" uuid,
	"payout_id" uuid,
	"available_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "ledger_entries_kind_check" CHECK ("ledger_entries"."kind" in ('sale_royalty','refund_reversal','chargeback_reversal','clawback','payout','adjustment'))
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "license_downloads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"license_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"file" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "license_downloads_file_check" CHECK ("license_downloads"."file" in ('master','mp3'))
);
--> statement-breakpoint
ALTER TABLE "license_downloads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"event" text NOT NULL,
	"actor_user_id" uuid,
	"reason" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"buyer_org_id" uuid NOT NULL,
	"buyer_user_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"track_id" uuid NOT NULL,
	"track_version_id" uuid NOT NULL,
	"seller_org_id" uuid NOT NULL,
	"tier" text NOT NULL,
	"terms_version_id" uuid NOT NULL,
	"license_text_document_id" uuid NOT NULL,
	"price_book_id" uuid NOT NULL,
	"price_level" text NOT NULL,
	"taxable_paise" bigint NOT NULL,
	"cgst_paise" bigint NOT NULL,
	"sgst_paise" bigint NOT NULL,
	"igst_paise" bigint NOT NULL,
	"total_paise" bigint NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"gst_rate_bps" integer NOT NULL,
	"royalty_rate_bps" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"gateway_order_id" text,
	"gateway_payment_id" text,
	"status" text DEFAULT 'created' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"fulfilled_at" timestamp with time zone,
	"fulfil_claimed_at" timestamp with time zone,
	"fulfil_attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_gateway_order_id_unique" UNIQUE("gateway_order_id"),
	CONSTRAINT "orders_gateway_payment_id_unique" UNIQUE("gateway_payment_id"),
	CONSTRAINT "orders_buyer_idempotency_key" UNIQUE("buyer_user_id","idempotency_key"),
	CONSTRAINT "orders_status_check" CHECK ("orders"."status" in ('created','awaiting_payment','paid','failed','expired','fulfilled','refund_pending','refunded','charged_back_pending','charged_back')),
	CONSTRAINT "orders_tier_check" CHECK ("orders"."tier" in ('creator','brand_organic','paid_ad')),
	CONSTRAINT "orders_currency_check" CHECK ("orders"."currency" = 'INR'),
	CONSTRAINT "orders_taxable_check" CHECK ("orders"."taxable_paise" > 0),
	CONSTRAINT "orders_total_check" CHECK ("orders"."total_paise" = "orders"."taxable_paise" + "orders"."cgst_paise" + "orders"."sgst_paise" + "orders"."igst_paise"),
	CONSTRAINT "orders_gst_split_check" CHECK (("orders"."igst_paise" = 0 and "orders"."cgst_paise" = "orders"."sgst_paise" and "orders"."cgst_paise" >= 0) or ("orders"."cgst_paise" = 0 and "orders"."sgst_paise" = 0 and "orders"."igst_paise" >= 0)),
	CONSTRAINT "orders_royalty_rate_check" CHECK ("orders"."royalty_rate_bps" between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"gateway_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "payment_events_gateway_event_id_unique" UNIQUE("gateway_event_id")
);
--> statement-breakpoint
ALTER TABLE "payment_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reconciliation_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"gateway_ref" text NOT NULL,
	"order_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_items_kind_ref_key" UNIQUE("kind","gateway_ref"),
	CONSTRAINT "reconciliation_items_kind_check" CHECK ("reconciliation_items"."kind" in ('unknown_payment','captured_not_paid','amount_mismatch','paid_without_capture','duplicate_payment')),
	CONSTRAINT "reconciliation_items_status_check" CHECK ("reconciliation_items"."status" in ('open','resolved'))
);
--> statement-breakpoint
ALTER TABLE "reconciliation_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_seller_org_id_organizations_id_fk" FOREIGN KEY ("seller_org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_downloads" ADD CONSTRAINT "license_downloads_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_downloads" ADD CONSTRAINT "license_downloads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_org_id_organizations_id_fk" FOREIGN KEY ("buyer_org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_track_version_id_track_versions_id_fk" FOREIGN KEY ("track_version_id") REFERENCES "public"."track_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_seller_org_id_organizations_id_fk" FOREIGN KEY ("seller_org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_terms_version_id_license_terms_versions_id_fk" FOREIGN KEY ("terms_version_id") REFERENCES "public"."license_terms_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_license_text_document_id_legal_documents_id_fk" FOREIGN KEY ("license_text_document_id") REFERENCES "public"."legal_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_price_book_id_price_books_id_fk" FOREIGN KEY ("price_book_id") REFERENCES "public"."price_books"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_order_kind_key" ON "ledger_entries" USING btree ("order_id","kind") WHERE "ledger_entries"."order_id" is not null;--> statement-breakpoint
CREATE INDEX "ledger_entries_seller_idx" ON "ledger_entries" USING btree ("seller_org_id","available_at");--> statement-breakpoint
CREATE INDEX "license_downloads_license_idx" ON "license_downloads" USING btree ("license_id");--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("order_id","at");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "orders_buyer_org_idx" ON "orders" USING btree ("buyer_org_id");--> statement-breakpoint
CREATE INDEX "payment_events_unprocessed_idx" ON "payment_events" USING btree ("received_at") WHERE "payment_events"."processed_at" is null;--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;
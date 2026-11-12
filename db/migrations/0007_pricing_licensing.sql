CREATE TABLE "license_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"license_id" uuid NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"event" text NOT NULL,
	"actor_user_id" uuid,
	"reason" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "license_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "license_terms_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tier" text NOT NULL,
	"version" integer NOT NULL,
	"term_kind" text NOT NULL,
	"term_months" integer,
	"video_cap" integer,
	"max_channels" integer NOT NULL,
	"allowed_platforms" text[] NOT NULL,
	"organic_only" boolean NOT NULL,
	"license_text_document_id" uuid NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "license_terms_versions_tier_version_key" UNIQUE("tier","version"),
	CONSTRAINT "license_terms_versions_tier_check" CHECK ("license_terms_versions"."tier" in ('creator','brand_organic','paid_ad')),
	CONSTRAINT "license_terms_versions_term_check" CHECK (("license_terms_versions"."term_kind" = 'perpetual' and "license_terms_versions"."term_months" is null) or ("license_terms_versions"."term_kind" = 'fixed_months' and "license_terms_versions"."term_months" > 0)),
	CONSTRAINT "license_terms_versions_video_cap_check" CHECK ("license_terms_versions"."video_cap" is null or "license_terms_versions"."video_cap" > 0),
	CONSTRAINT "license_terms_versions_max_channels_check" CHECK ("license_terms_versions"."max_channels" > 0),
	CONSTRAINT "license_terms_versions_platforms_check" CHECK (cardinality("license_terms_versions"."allowed_platforms") > 0 and "license_terms_versions"."allowed_platforms" <@ array['youtube','instagram','facebook']::text[])
);
--> statement-breakpoint
ALTER TABLE "license_terms_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "licensed_channels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"license_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"handle_or_url" text NOT NULL,
	"external_id" text,
	"verification_status" text DEFAULT 'unverified' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "licensed_channels_platform_check" CHECK ("licensed_channels"."platform" in ('youtube','instagram','facebook')),
	CONSTRAINT "licensed_channels_verification_check" CHECK ("licensed_channels"."verification_status" in ('unverified','pending','verified'))
);
--> statement-breakpoint
ALTER TABLE "licensed_channels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "licensed_videos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"license_id" uuid NOT NULL,
	"label" text NOT NULL,
	"urls" text[] NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "licensed_videos_urls_check" CHECK (cardinality("licensed_videos"."urls") between 1 and 10)
);
--> statement-breakpoint
ALTER TABLE "licensed_videos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "licenses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"order_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"track_version_id" uuid NOT NULL,
	"master_sha256" text NOT NULL,
	"track_title" text NOT NULL,
	"primary_artist" text NOT NULL,
	"tier" text NOT NULL,
	"terms_version_id" uuid NOT NULL,
	"license_text_document_id" uuid NOT NULL,
	"license_text_sha256" text NOT NULL,
	"licensee_name" text NOT NULL,
	"client_name" text,
	"purchaser_org_id" uuid NOT NULL,
	"territory" text DEFAULT 'worldwide' NOT NULL,
	"edits_allowed" boolean NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"invoice_number" text NOT NULL,
	"hash_schema" text NOT NULL,
	"record_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"revoked_reason" text,
	"revoked_at" timestamp with time zone,
	"renews_license_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "licenses_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "licenses_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "licenses_status_check" CHECK ("licenses"."status" in ('active','expired','revoked')),
	CONSTRAINT "licenses_tier_check" CHECK ("licenses"."tier" in ('creator','brand_organic','paid_ad')),
	CONSTRAINT "licenses_territory_check" CHECK ("licenses"."territory" = 'worldwide'),
	CONSTRAINT "licenses_term_check" CHECK ("licenses"."ends_at" is null or "licenses"."ends_at" > "licenses"."starts_at"),
	CONSTRAINT "licenses_record_hash_check" CHECK ("licenses"."record_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "licenses_revoked_check" CHECK (("licenses"."status" = 'revoked') = ("licenses"."revoked_reason" is not null and "licenses"."revoked_at" is not null)),
	CONSTRAINT "licenses_revoked_reason_check" CHECK ("licenses"."revoked_reason" is null or "licenses"."revoked_reason" in ('refund','chargeback_lost','fraud','breach'))
);
--> statement-breakpoint
ALTER TABLE "licenses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "price_book_entries" (
	"price_book_id" uuid NOT NULL,
	"price_level" text NOT NULL,
	"tier" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	CONSTRAINT "price_book_entries_price_book_id_price_level_tier_pk" PRIMARY KEY("price_book_id","price_level","tier"),
	CONSTRAINT "price_book_entries_level_check" CHECK ("price_book_entries"."price_level" in ('L1','L2','L3','L4','L5')),
	CONSTRAINT "price_book_entries_tier_check" CHECK ("price_book_entries"."tier" in ('creator','brand_organic','paid_ad')),
	CONSTRAINT "price_book_entries_amount_check" CHECK ("price_book_entries"."amount_paise" > 0)
);
--> statement-breakpoint
ALTER TABLE "price_book_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "price_books" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"effective_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_books_version_unique" UNIQUE("version"),
	CONSTRAINT "price_books_status_check" CHECK ("price_books"."status" in ('draft','active','retired'))
);
--> statement-breakpoint
ALTER TABLE "price_books" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "license_events" ADD CONSTRAINT "license_events_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_terms_versions" ADD CONSTRAINT "license_terms_versions_license_text_document_id_legal_documents_id_fk" FOREIGN KEY ("license_text_document_id") REFERENCES "public"."legal_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licensed_channels" ADD CONSTRAINT "licensed_channels_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licensed_videos" ADD CONSTRAINT "licensed_videos_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_track_version_id_track_versions_id_fk" FOREIGN KEY ("track_version_id") REFERENCES "public"."track_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_terms_version_id_license_terms_versions_id_fk" FOREIGN KEY ("terms_version_id") REFERENCES "public"."license_terms_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_license_text_document_id_legal_documents_id_fk" FOREIGN KEY ("license_text_document_id") REFERENCES "public"."legal_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_purchaser_org_id_organizations_id_fk" FOREIGN KEY ("purchaser_org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_renews_license_id_licenses_id_fk" FOREIGN KEY ("renews_license_id") REFERENCES "public"."licenses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_book_entries" ADD CONSTRAINT "price_book_entries_price_book_id_price_books_id_fk" FOREIGN KEY ("price_book_id") REFERENCES "public"."price_books"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_books" ADD CONSTRAINT "price_books_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "license_events_license_idx" ON "license_events" USING btree ("license_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "licensed_channels_active_key" ON "licensed_channels" USING btree ("license_id","platform",lower("handle_or_url")) WHERE "licensed_channels"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "licensed_channels_license_idx" ON "licensed_channels" USING btree ("license_id");--> statement-breakpoint
CREATE INDEX "licensed_videos_license_idx" ON "licensed_videos" USING btree ("license_id");--> statement-breakpoint
CREATE INDEX "licenses_purchaser_idx" ON "licenses" USING btree ("purchaser_org_id");--> statement-breakpoint
CREATE INDEX "licenses_track_idx" ON "licenses" USING btree ("track_id");--> statement-breakpoint
CREATE INDEX "licenses_expiry_idx" ON "licenses" USING btree ("ends_at") WHERE "licenses"."status" = 'active' and "licenses"."ends_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "price_books_one_active_idx" ON "price_books" USING btree ("status") WHERE "price_books"."status" = 'active';
CREATE TABLE "claim_probes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"track_version_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"probed_by" uuid NOT NULL,
	"probed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claims_observed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	CONSTRAINT "claim_probes_platform_check" CHECK ("claim_probes"."platform" in ('youtube','meta'))
);
--> statement-breakpoint
ALTER TABLE "claim_probes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "genres" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "genres_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "genres" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "moods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "moods_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "moods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rights_declarations" (
	"track_id" uuid PRIMARY KEY NOT NULL,
	"master_controlled" boolean NOT NULL,
	"composition_controlled" boolean NOT NULL,
	"co_owner_consent_warranted" boolean NOT NULL,
	"sample_free_warranted" boolean NOT NULL,
	"not_a_cover_warranted" boolean NOT NULL,
	"registrations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"accepted_document_id" uuid,
	"declared_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rights_declarations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rights_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"track_id" uuid NOT NULL,
	"seller_org_id" uuid NOT NULL,
	"doc_type" text NOT NULL,
	"declared_mime" text NOT NULL,
	"file_key" text NOT NULL,
	"size_bytes" bigint,
	"validation_status" text DEFAULT 'pending' NOT NULL,
	"validation_error" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rights_documents_doc_type_check" CHECK ("rights_documents"."doc_type" in ('pro_registration','distribution_agreement','publishing_agreement','self_declaration','other')),
	CONSTRAINT "rights_documents_validation_status_check" CHECK ("rights_documents"."validation_status" in ('pending','valid','rejected'))
);
--> statement-breakpoint
ALTER TABLE "rights_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "screenings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"track_version_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"matches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "screenings_status_check" CHECK ("screenings"."status" in ('queued','clean','match','error','unavailable'))
);
--> statement-breakpoint
ALTER TABLE "screenings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "seller_profiles" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"pan_encrypted" text,
	"gstin" text,
	"gst_registered" boolean DEFAULT false NOT NULL,
	"onboarding_mode" text DEFAULT 'self_serve' NOT NULL,
	"royalty_rate_bps" integer,
	"ops_contact_email" text,
	"ops_contact_phone" text,
	"kyc_status" text DEFAULT 'pending' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"worldwide_rights_warranted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_profiles_entity_type_check" CHECK ("seller_profiles"."entity_type" in ('individual','company','partnership','llp')),
	CONSTRAINT "seller_profiles_onboarding_mode_check" CHECK ("seller_profiles"."onboarding_mode" in ('self_serve','concierge')),
	CONSTRAINT "seller_profiles_kyc_status_check" CHECK ("seller_profiles"."kyc_status" in ('pending','verified','rejected')),
	CONSTRAINT "seller_profiles_status_check" CHECK ("seller_profiles"."status" in ('active','suspended','closed'))
);
--> statement-breakpoint
ALTER TABLE "seller_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "track_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"track_id" uuid NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"event" text NOT NULL,
	"actor_user_id" uuid,
	"reason" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "track_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "track_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"track_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"master_key" text NOT NULL,
	"master_sha256" text,
	"master_format" text,
	"duration_ms" integer,
	"sample_rate" integer,
	"preview_key" text,
	"preview_download_key" text,
	"mp3_derivative_key" text,
	"waveform_key" text,
	"ingest_status" text DEFAULT 'pending' NOT NULL,
	"ingest_error" text,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "track_versions_track_version_key" UNIQUE("track_id","version_no"),
	CONSTRAINT "track_versions_ingest_status_check" CHECK ("track_versions"."ingest_status" in ('pending','processing','ready','failed'))
);
--> statement-breakpoint
ALTER TABLE "track_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tracks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seller_org_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"primary_artist" text NOT NULL,
	"featured_artists" text[] DEFAULT '{}'::text[] NOT NULL,
	"composers" text[] DEFAULT '{}'::text[] NOT NULL,
	"lyricists" text[] DEFAULT '{}'::text[] NOT NULL,
	"genre_id" uuid,
	"mood_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"language" text NOT NULL,
	"bpm" integer,
	"explicit" boolean DEFAULT false NOT NULL,
	"ai_generated_declared" boolean DEFAULT false NOT NULL,
	"organic_social" boolean DEFAULT true NOT NULL,
	"paid_ads" boolean DEFAULT false NOT NULL,
	"edits_allowed" boolean DEFAULT false NOT NULL,
	"proposed_price_level" text,
	"price_level" text,
	"clearance_class" text DEFAULT 'unclassified' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"rejection_reason" text,
	"current_version_id" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracks_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tracks_status_check" CHECK ("tracks"."status" in ('draft','submitted','in_review','published','rejected','suspended','delisted')),
	CONSTRAINT "tracks_clearance_class_check" CHECK ("tracks"."clearance_class" in ('unclassified','A','B','C')),
	CONSTRAINT "tracks_language_check" CHECK ("tracks"."language" in ('hindi','punjabi','tamil','english','instrumental')),
	CONSTRAINT "tracks_price_level_check" CHECK ("tracks"."price_level" is null or "tracks"."price_level" in ('L1','L2','L3','L4','L5')),
	CONSTRAINT "tracks_proposed_price_level_check" CHECK ("tracks"."proposed_price_level" is null or "tracks"."proposed_price_level" in ('L1','L2','L3','L4','L5'))
);
--> statement-breakpoint
ALTER TABLE "tracks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "claim_probes" ADD CONSTRAINT "claim_probes_track_version_id_track_versions_id_fk" FOREIGN KEY ("track_version_id") REFERENCES "public"."track_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_probes" ADD CONSTRAINT "claim_probes_probed_by_users_id_fk" FOREIGN KEY ("probed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rights_declarations" ADD CONSTRAINT "rights_declarations_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rights_declarations" ADD CONSTRAINT "rights_declarations_accepted_document_id_legal_documents_id_fk" FOREIGN KEY ("accepted_document_id") REFERENCES "public"."legal_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rights_documents" ADD CONSTRAINT "rights_documents_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rights_documents" ADD CONSTRAINT "rights_documents_seller_org_id_organizations_id_fk" FOREIGN KEY ("seller_org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenings" ADD CONSTRAINT "screenings_track_version_id_track_versions_id_fk" FOREIGN KEY ("track_version_id") REFERENCES "public"."track_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD CONSTRAINT "seller_profiles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_events" ADD CONSTRAINT "track_events_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_versions" ADD CONSTRAINT "track_versions_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_seller_org_id_organizations_id_fk" FOREIGN KEY ("seller_org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_genre_id_genres_id_fk" FOREIGN KEY ("genre_id") REFERENCES "public"."genres"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rights_documents_track_idx" ON "rights_documents" USING btree ("track_id");--> statement-breakpoint
CREATE INDEX "screenings_version_idx" ON "screenings" USING btree ("track_version_id");--> statement-breakpoint
CREATE INDEX "track_events_track_idx" ON "track_events" USING btree ("track_id","at");--> statement-breakpoint
CREATE INDEX "tracks_status_idx" ON "tracks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tracks_seller_idx" ON "tracks" USING btree ("seller_org_id");
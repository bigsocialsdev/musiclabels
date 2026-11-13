CREATE TABLE "channel_verifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"licensed_channel_id" uuid NOT NULL,
	"method" text NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"checked_by" uuid,
	"checked_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_verifications_method_check" CHECK ("channel_verifications"."method" in ('bio_code','oauth_google','oauth_meta')),
	CONSTRAINT "channel_verifications_status_check" CHECK ("channel_verifications"."status" in ('pending','verified','failed'))
);
--> statement-breakpoint
ALTER TABLE "channel_verifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "clearance_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"license_id" uuid NOT NULL,
	"licensed_channel_id" uuid,
	"licensed_video_id" uuid,
	"seller_org_id" uuid NOT NULL,
	"provider" text DEFAULT 'manual_seller' NOT NULL,
	"scope" text NOT NULL,
	"clearance_class" text NOT NULL,
	"status" text NOT NULL,
	"respond_token_hash" text,
	"token_expires_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"seller_note" text,
	"evidence_key" text,
	"external_ref" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clearance_requests_status_check" CHECK ("clearance_requests"."status" in ('not_required','pending','sent','completed','failed','overdue','escalated')),
	CONSTRAINT "clearance_requests_provider_check" CHECK ("clearance_requests"."provider" in ('manual_seller')),
	CONSTRAINT "clearance_requests_scope_check" CHECK (("clearance_requests"."scope" = 'channel' and "clearance_requests"."licensed_channel_id" is not null and "clearance_requests"."licensed_video_id" is null) or ("clearance_requests"."scope" = 'video' and "clearance_requests"."licensed_video_id" is not null and "clearance_requests"."licensed_channel_id" is null)),
	CONSTRAINT "clearance_requests_class_check" CHECK ("clearance_requests"."clearance_class" in ('A','B'))
);
--> statement-breakpoint
ALTER TABLE "clearance_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "copyright_complaints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"complainant_name" text NOT NULL,
	"complainant_email" text NOT NULL,
	"track_id" uuid,
	"work_claimed" text NOT NULL,
	"evidence_key" text,
	"status" text DEFAULT 'received' NOT NULL,
	"grievance_officer_id" uuid,
	"outcome_note" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "copyright_complaints_status_check" CHECK ("copyright_complaints"."status" in ('received','investigating','upheld','rejected'))
);
--> statement-breakpoint
ALTER TABLE "copyright_complaints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dispute_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dispute_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"actor_user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dispute_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"license_id" uuid NOT NULL,
	"opened_by" uuid NOT NULL,
	"video_url" text NOT NULL,
	"platform" text NOT NULL,
	"dispute_type" text NOT NULL,
	"claimant_name" text NOT NULL,
	"claimant_cataloged" boolean DEFAULT false NOT NULL,
	"clearance_class_at_open" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"first_action_due_at" timestamp with time zone NOT NULL,
	"resolution_due_at" timestamp with time zone,
	"refund_eligible_at" timestamp with time zone NOT NULL,
	"overdue_notified_at" timestamp with time zone,
	"resolution" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disputes_status_check" CHECK ("disputes"."status" in ('open','in_progress','resolved_released','resolved_denied','refund_eligible','resolved_refunded','resolved_kit_issued')),
	CONSTRAINT "disputes_platform_check" CHECK ("disputes"."platform" in ('youtube','instagram','facebook')),
	CONSTRAINT "disputes_type_check" CHECK ("disputes"."dispute_type" in ('content_id_claim','copyright_strike','mute','ad_rejection','other')),
	CONSTRAINT "disputes_class_check" CHECK ("disputes"."clearance_class_at_open" in ('A','B','C','unclassified'))
);
--> statement-breakpoint
ALTER TABLE "disputes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "enquiries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid,
	"contact_name" text NOT NULL,
	"contact_email" text NOT NULL,
	"contact_phone" text,
	"track_id" uuid NOT NULL,
	"intended_use" text NOT NULL,
	"media" text NOT NULL,
	"budget_range" text,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enquiries_media_check" CHECK ("enquiries"."media" in ('tv','ott','cinema','other')),
	CONSTRAINT "enquiries_status_check" CHECK ("enquiries"."status" in ('new','contacted','closed_won','closed_lost'))
);
--> statement-breakpoint
ALTER TABLE "enquiries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "channel_verifications" ADD CONSTRAINT "channel_verifications_licensed_channel_id_licensed_channels_id_fk" FOREIGN KEY ("licensed_channel_id") REFERENCES "public"."licensed_channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_verifications" ADD CONSTRAINT "channel_verifications_checked_by_users_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clearance_requests" ADD CONSTRAINT "clearance_requests_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clearance_requests" ADD CONSTRAINT "clearance_requests_licensed_channel_id_licensed_channels_id_fk" FOREIGN KEY ("licensed_channel_id") REFERENCES "public"."licensed_channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clearance_requests" ADD CONSTRAINT "clearance_requests_licensed_video_id_licensed_videos_id_fk" FOREIGN KEY ("licensed_video_id") REFERENCES "public"."licensed_videos"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clearance_requests" ADD CONSTRAINT "clearance_requests_seller_org_id_organizations_id_fk" FOREIGN KEY ("seller_org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copyright_complaints" ADD CONSTRAINT "copyright_complaints_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copyright_complaints" ADD CONSTRAINT "copyright_complaints_grievance_officer_id_users_id_fk" FOREIGN KEY ("grievance_officer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_events" ADD CONSTRAINT "dispute_events_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_verifications_pending_key" ON "channel_verifications" USING btree ("licensed_channel_id") WHERE "channel_verifications"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "clearance_requests_channel_key" ON "clearance_requests" USING btree ("licensed_channel_id") WHERE "clearance_requests"."licensed_channel_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "clearance_requests_video_key" ON "clearance_requests" USING btree ("licensed_video_id") WHERE "clearance_requests"."licensed_video_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "clearance_requests_token_key" ON "clearance_requests" USING btree ("respond_token_hash") WHERE "clearance_requests"."respond_token_hash" is not null;--> statement-breakpoint
CREATE INDEX "clearance_requests_status_idx" ON "clearance_requests" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "clearance_requests_license_idx" ON "clearance_requests" USING btree ("license_id");--> statement-breakpoint
CREATE INDEX "clearance_requests_seller_idx" ON "clearance_requests" USING btree ("seller_org_id","status");--> statement-breakpoint
CREATE INDEX "copyright_complaints_status_idx" ON "copyright_complaints" USING btree ("status","received_at");--> statement-breakpoint
CREATE INDEX "dispute_events_dispute_idx" ON "dispute_events" USING btree ("dispute_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "disputes_open_claim_key" ON "disputes" USING btree ("license_id","video_url","dispute_type") WHERE "disputes"."status" in ('open','in_progress');--> statement-breakpoint
CREATE INDEX "disputes_status_idx" ON "disputes" USING btree ("status","first_action_due_at");--> statement-breakpoint
CREATE INDEX "disputes_license_idx" ON "disputes" USING btree ("license_id");--> statement-breakpoint
CREATE INDEX "enquiries_status_idx" ON "enquiries" USING btree ("status","created_at");
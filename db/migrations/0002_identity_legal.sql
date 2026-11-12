CREATE TABLE "acceptances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid,
	"legal_document_id" uuid NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text,
	CONSTRAINT "acceptances_user_document_key" UNIQUE("user_id","legal_document_id")
);
--> statement-breakpoint
ALTER TABLE "acceptances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "legal_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"body_markdown" text NOT NULL,
	"sha256" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_documents_kind_version_key" UNIQUE("kind","version"),
	CONSTRAINT "legal_documents_kind_check" CHECK ("legal_documents"."kind" in ('tos','privacy','seller_agreement','release_commitment','license_creator','license_brand_organic','license_paid_ad'))
);
--> statement-breakpoint
ALTER TABLE "legal_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "memberships" (
	"user_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_user_id_org_id_pk" PRIMARY KEY("user_id","org_id"),
	CONSTRAINT "memberships_role_check" CHECK ("memberships"."role" in ('owner','member'))
);
--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"legal_name" text NOT NULL,
	"display_name" text NOT NULL,
	"buyer_type" text,
	"gstin" text,
	"state_code" text,
	"billing_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_kind_check" CHECK ("organizations"."kind" in ('seller','buyer')),
	CONSTRAINT "organizations_buyer_type_check" CHECK ("organizations"."buyer_type" is null or "organizations"."buyer_type" in ('individual','business','agency'))
);
--> statement-breakpoint
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text,
	"phone" text,
	"name" text,
	"verified_at" timestamp with time zone,
	"platform_role" text DEFAULT 'none' NOT NULL,
	"admin_permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_phone_unique" UNIQUE("phone"),
	CONSTRAINT "users_platform_role_check" CHECK ("users"."platform_role" in ('none','admin')),
	CONSTRAINT "users_admin_permissions_check" CHECK ("users"."admin_permissions" <@ array['verification','clearance','disputes','finance','superadmin']::text[])
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "acceptances" ADD CONSTRAINT "acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptances" ADD CONSTRAINT "acceptances_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptances" ADD CONSTRAINT "acceptances_legal_document_id_legal_documents_id_fk" FOREIGN KEY ("legal_document_id") REFERENCES "public"."legal_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
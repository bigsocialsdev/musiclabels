ALTER TABLE "organizations" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "suspension_reason" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_suspension_check" CHECK (("organizations"."suspended_at" is null) = ("organizations"."suspension_reason" is null));
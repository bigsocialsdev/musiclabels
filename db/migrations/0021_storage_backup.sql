CREATE TABLE "storage_backups" (
	"bucket" text NOT NULL,
	"path" text NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"size_bytes" bigint NOT NULL,
	"md5" text NOT NULL,
	"backed_up_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_backups_bucket_path_pk" PRIMARY KEY("bucket","path"),
	CONSTRAINT "storage_backups_md5_check" CHECK ("storage_backups"."md5" ~ '^[0-9a-f]{32}$')
);
--> statement-breakpoint
ALTER TABLE "storage_backups" ENABLE ROW LEVEL SECURITY;
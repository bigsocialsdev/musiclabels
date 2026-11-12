DROP INDEX "screenings_version_idx";--> statement-breakpoint
ALTER TABLE "screenings" ADD CONSTRAINT "screenings_track_version_key" UNIQUE("track_version_id");
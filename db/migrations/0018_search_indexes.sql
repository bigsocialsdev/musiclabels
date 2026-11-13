-- Discovery search (PLAN S4-M8): trigram indexes for fuzzy title/artist matching, and a full-text index over the
-- same two columns ('simple' config: names and transliterated Hindi/Punjabi/Tamil words must not be stemmed).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX tracks_title_trgm_idx ON public.tracks USING gin (title gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX tracks_artist_trgm_idx ON public.tracks USING gin (primary_artist gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX tracks_fts_idx ON public.tracks USING gin (to_tsvector('simple', title || ' ' || primary_artist));

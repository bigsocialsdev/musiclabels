-- Track status history is insert-only (CLAUDE.md: every transition writes its event row).
SELECT mrm_append_only('track_events');

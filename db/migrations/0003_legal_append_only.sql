-- legal_documents and acceptances are insert-only (CLAUDE.md append-only list).
SELECT mrm_append_only('legal_documents');
--> statement-breakpoint
SELECT mrm_append_only('acceptances');

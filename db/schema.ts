import { sql } from 'drizzle-orm';
import { check, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from '../lib/platform/ids';

// Conventions (CLAUDE.md): UUIDv7 ids, money in bigint paise, timestamptz, status columns with CHECKs.
// Every table calls .enableRLS() with no anon/authenticated policies; tests/rls.test.ts enforces it.

const id = () => uuid('id').primaryKey().$defaultFn(uuidv7);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** platform: Postgres-backed token buckets (PLAN §10). */
export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  tokens: doublePrecision('tokens').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

/** audit: append-only (DB trigger, see migrations). */
export const auditLog = pgTable('audit_log', {
  id: id(),
  actorUserId: uuid('actor_user_id'), // null for system actions; FK to users added in S3-M1
  impersonatedBy: uuid('impersonated_by'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
  ip: text('ip'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

/** notifications: transactional outbox, written in the same transaction as the state change. */
export const outbox = pgTable(
  'outbox',
  {
    id: id(),
    kind: text('kind').notNull(),
    to: text('to').notNull(),
    template: text('template').notNull(),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: createdAt(),
  },
  (t) => [
    check('outbox_status_check', sql`${t.status} in ('pending','sending','sent','failed')`),
    index('outbox_status_created_idx').on(t.status, t.createdAt),
  ],
).enableRLS();

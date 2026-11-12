import { sql } from 'drizzle-orm';
import { check, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
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

// ---- identity (S3-M1) ----
// users.id equals the Supabase auth user id by convention (no FK: the row is created by identity's
// ensureUser after sign-in, so the app database does not depend on the auth schema).

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    email: text('email').unique(),
    phone: text('phone').unique(),
    name: text('name'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    platformRole: text('platform_role').notNull().default('none'),
    adminPermissions: text('admin_permissions').array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
  },
  (t) => [
    check('users_platform_role_check', sql`${t.platformRole} in ('none','admin')`),
    check(
      'users_admin_permissions_check',
      sql`${t.adminPermissions} <@ array['verification','clearance','disputes','finance','superadmin']::text[]`,
    ),
  ],
).enableRLS();

export const organizations = pgTable(
  'organizations',
  {
    id: id(),
    kind: text('kind').notNull(),
    legalName: text('legal_name').notNull(),
    displayName: text('display_name').notNull(),
    buyerType: text('buyer_type'), // buyer orgs only
    gstin: text('gstin'),
    stateCode: text('state_code'),
    billingAddress: text('billing_address'),
    createdAt: createdAt(),
  },
  (t) => [
    check('organizations_kind_check', sql`${t.kind} in ('seller','buyer')`),
    check('organizations_buyer_type_check', sql`${t.buyerType} is null or ${t.buyerType} in ('individual','business','agency')`),
  ],
).enableRLS();

export const memberships = pgTable(
  'memberships',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    role: text('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.orgId] }),
    check('memberships_role_check', sql`${t.role} in ('owner','member')`),
  ],
).enableRLS();

// ---- legal (S3-M1) ----


/** Immutable after insert (append-only trigger). */
export const legalDocuments = pgTable(
  'legal_documents',
  {
    id: id(),
    kind: text('kind').notNull(),
    version: integer('version').notNull(),
    bodyMarkdown: text('body_markdown').notNull(),
    sha256: text('sha256').notNull(),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('legal_documents_kind_version_key').on(t.kind, t.version),
    check(
      'legal_documents_kind_check',
      sql`${t.kind} in ('tos','privacy','seller_agreement','release_commitment','license_creator','license_brand_organic','license_paid_ad')`,
    ),
  ],
).enableRLS();

/** Append-only. One acceptance per user per document version; org is the org acted for, if any. */
export const acceptances = pgTable(
  'acceptances',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'restrict' }),
    legalDocumentId: uuid('legal_document_id').notNull().references(() => legalDocuments.id, { onDelete: 'restrict' }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [unique('acceptances_user_document_key').on(t.userId, t.legalDocumentId)],
).enableRLS();

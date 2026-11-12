import { sql } from 'drizzle-orm';
import { bigint, boolean, check, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
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

// ---- sellers (minimal; onboarding UI arrives in S4-M7) ----

export const sellerProfiles = pgTable(
  'seller_profiles',
  {
    orgId: uuid('org_id').primaryKey().references(() => organizations.id, { onDelete: 'restrict' }),
    entityType: text('entity_type').notNull(),
    panEncrypted: text('pan_encrypted'),
    gstin: text('gstin'),
    gstRegistered: boolean('gst_registered').notNull().default(false),
    onboardingMode: text('onboarding_mode').notNull().default('self_serve'),
    royaltyRateBps: integer('royalty_rate_bps'), // contract rate; null = platform default from config
    opsContactEmail: text('ops_contact_email'),
    opsContactPhone: text('ops_contact_phone'),
    kycStatus: text('kyc_status').notNull().default('pending'),
    status: text('status').notNull().default('active'),
    worldwideRightsWarranted: boolean('worldwide_rights_warranted').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    check('seller_profiles_entity_type_check', sql`${t.entityType} in ('individual','company','partnership','llp')`),
    check('seller_profiles_onboarding_mode_check', sql`${t.onboardingMode} in ('self_serve','concierge')`),
    check('seller_profiles_kyc_status_check', sql`${t.kycStatus} in ('pending','verified','rejected')`),
    check('seller_profiles_status_check', sql`${t.status} in ('active','suspended','closed')`),
  ],
).enableRLS();

// ---- catalog (S3-M2) ----

export const genres = pgTable('genres', {
  id: id(),
  name: text('name').notNull().unique(),
  active: boolean('active').notNull().default(true),
}).enableRLS();

export const moods = pgTable('moods', {
  id: id(),
  name: text('name').notNull().unique(),
  active: boolean('active').notNull().default(true),
}).enableRLS();

export const tracks = pgTable(
  'tracks',
  {
    id: id(),
    sellerOrgId: uuid('seller_org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    primaryArtist: text('primary_artist').notNull(),
    featuredArtists: text('featured_artists').array().notNull().default(sql`'{}'::text[]`),
    composers: text('composers').array().notNull().default(sql`'{}'::text[]`),
    lyricists: text('lyricists').array().notNull().default(sql`'{}'::text[]`),
    genreId: uuid('genre_id').references(() => genres.id, { onDelete: 'restrict' }),
    moodIds: uuid('mood_ids').array().notNull().default(sql`'{}'::uuid[]`),
    language: text('language').notNull(),
    bpm: integer('bpm'),
    explicit: boolean('explicit').notNull().default(false),
    aiGeneratedDeclared: boolean('ai_generated_declared').notNull().default(false),
    organicSocial: boolean('organic_social').notNull().default(true),
    paidAds: boolean('paid_ads').notNull().default(false),
    editsAllowed: boolean('edits_allowed').notNull().default(false),
    proposedPriceLevel: text('proposed_price_level'), // seller's suggestion
    priceLevel: text('price_level'), // set by admin at approval
    clearanceClass: text('clearance_class').notNull().default('unclassified'),
    status: text('status').notNull().default('draft'),
    rejectionReason: text('rejection_reason'),
    currentVersionId: uuid('current_version_id'), // the version buyers get; set at approval (no FK: circular with track_versions)
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('tracks_status_check', sql`${t.status} in ('draft','submitted','in_review','published','rejected','suspended','delisted')`),
    check('tracks_clearance_class_check', sql`${t.clearanceClass} in ('unclassified','A','B','C')`),
    check('tracks_language_check', sql`${t.language} in ('hindi','punjabi','tamil','english','instrumental')`),
    check('tracks_price_level_check', sql`${t.priceLevel} is null or ${t.priceLevel} in ('L1','L2','L3','L4','L5')`),
    check('tracks_proposed_price_level_check', sql`${t.proposedPriceLevel} is null or ${t.proposedPriceLevel} in ('L1','L2','L3','L4','L5')`),
    index('tracks_status_idx').on(t.status),
    index('tracks_seller_idx').on(t.sellerOrgId),
  ],
).enableRLS();

/** Append-only history of track status changes (every transition writes one). */
export const trackEvents = pgTable(
  'track_events',
  {
    id: id(),
    trackId: uuid('track_id').notNull().references(() => tracks.id, { onDelete: 'restrict' }),
    fromStatus: text('from_status').notNull(),
    toStatus: text('to_status').notNull(),
    event: text('event').notNull(),
    actorUserId: uuid('actor_user_id'), // null = system
    reason: text('reason'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('track_events_track_idx').on(t.trackId, t.at)],
).enableRLS();

export const trackVersions = pgTable(
  'track_versions',
  {
    id: id(),
    trackId: uuid('track_id').notNull().references(() => tracks.id, { onDelete: 'restrict' }),
    versionNo: integer('version_no').notNull(),
    masterKey: text('master_key').notNull(),
    masterSha256: text('master_sha256'),
    masterFormat: text('master_format'),
    durationMs: integer('duration_ms'),
    sampleRate: integer('sample_rate'),
    previewKey: text('preview_key'),
    previewDownloadKey: text('preview_download_key'),
    mp3DerivativeKey: text('mp3_derivative_key'),
    waveformKey: text('waveform_key'),
    ingestStatus: text('ingest_status').notNull().default('pending'),
    ingestError: text('ingest_error'), // seller-visible reason
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('track_versions_track_version_key').on(t.trackId, t.versionNo),
    check('track_versions_ingest_status_check', sql`${t.ingestStatus} in ('pending','processing','ready','failed')`),
  ],
).enableRLS();

export const rightsDeclarations = pgTable('rights_declarations', {
  trackId: uuid('track_id').primaryKey().references(() => tracks.id, { onDelete: 'restrict' }),
  masterControlled: boolean('master_controlled').notNull(),
  compositionControlled: boolean('composition_controlled').notNull(),
  coOwnerConsentWarranted: boolean('co_owner_consent_warranted').notNull(),
  sampleFreeWarranted: boolean('sample_free_warranted').notNull(),
  notACoverWarranted: boolean('not_a_cover_warranted').notNull(),
  // [{ system: 'youtube_cid'|'meta_rm'|'other', administeredBy: string, sellerControlsRelease: boolean }]
  registrations: jsonb('registrations').notNull().default(sql`'[]'::jsonb`),
  acceptedDocumentId: uuid('accepted_document_id').references(() => legalDocuments.id, { onDelete: 'restrict' }),
  declaredAt: timestamp('declared_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const rightsDocuments = pgTable(
  'rights_documents',
  {
    id: id(),
    trackId: uuid('track_id').notNull().references(() => tracks.id, { onDelete: 'restrict' }),
    sellerOrgId: uuid('seller_org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    docType: text('doc_type').notNull(),
    declaredMime: text('declared_mime').notNull(),
    fileKey: text('file_key').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    validationStatus: text('validation_status').notNull().default('pending'),
    validationError: text('validation_error'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'rights_documents_doc_type_check',
      sql`${t.docType} in ('pro_registration','distribution_agreement','publishing_agreement','self_declaration','other')`,
    ),
    check('rights_documents_validation_status_check', sql`${t.validationStatus} in ('pending','valid','rejected')`),
    index('rights_documents_track_idx').on(t.trackId),
  ],
).enableRLS();

// ---- screening (S3-M2) ----

export const screenings = pgTable(
  'screenings',
  {
    id: id(),
    trackVersionId: uuid('track_version_id').notNull().references(() => trackVersions.id, { onDelete: 'restrict' }),
    provider: text('provider').notNull(),
    status: text('status').notNull(),
    matches: jsonb('matches').notNull().default(sql`'[]'::jsonb`), // [{ title, artist, label, score, source }]
    createdAt: createdAt(),
  },
  (t) => [
    check('screenings_status_check', sql`${t.status} in ('queued','clean','match','error','unavailable')`),
    unique('screenings_track_version_key').on(t.trackVersionId),
  ],
).enableRLS();

export const claimProbes = pgTable(
  'claim_probes',
  {
    id: id(),
    trackVersionId: uuid('track_version_id').notNull().references(() => trackVersions.id, { onDelete: 'restrict' }),
    platform: text('platform').notNull(),
    probedBy: uuid('probed_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    probedAt: timestamp('probed_at', { withTimezone: true }).notNull().defaultNow(),
    claimsObserved: jsonb('claims_observed').notNull().default(sql`'[]'::jsonb`), // [{ claimant, policy }]
    notes: text('notes'),
  },
  (t) => [check('claim_probes_platform_check', sql`${t.platform} in ('youtube','meta')`)],
).enableRLS();

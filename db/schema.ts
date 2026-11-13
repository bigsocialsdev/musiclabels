import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
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

// ---- pricing (S3-M3) ----

/** Platform-owned price grid, versioned. At most one `active` book (partial unique index). */
export const priceBooks = pgTable(
  'price_books',
  {
    id: id(),
    version: integer('version').notNull().unique(),
    status: text('status').notNull().default('draft'),
    effectiveAt: timestamp('effective_at', { withTimezone: true }), // set on activation
    createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    check('price_books_status_check', sql`${t.status} in ('draft','active','retired')`),
    uniqueIndex('price_books_one_active_idx').on(t.status).where(sql`${t.status} = 'active'`),
  ],
).enableRLS();

/** Append-only: a book's grid is written once, with the book. amount_paise is the taxable value (GST-exclusive). */
export const priceBookEntries = pgTable(
  'price_book_entries',
  {
    priceBookId: uuid('price_book_id').notNull().references(() => priceBooks.id, { onDelete: 'restrict' }),
    priceLevel: text('price_level').notNull(),
    tier: text('tier').notNull(),
    amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.priceBookId, t.priceLevel, t.tier] }),
    check('price_book_entries_level_check', sql`${t.priceLevel} in ('L1','L2','L3','L4','L5')`),
    check('price_book_entries_tier_check', sql`${t.tier} in ('creator','brand_organic','paid_ad')`),
    check('price_book_entries_amount_check', sql`${t.amountPaise} > 0`),
  ],
).enableRLS();

// ---- licensing (S3-M3) ----

/** Tier rules, versioned and immutable (append-only). A license pins the version it was sold under. */
export const licenseTermsVersions = pgTable(
  'license_terms_versions',
  {
    id: id(),
    tier: text('tier').notNull(),
    version: integer('version').notNull(),
    termKind: text('term_kind').notNull(),
    termMonths: integer('term_months'),
    videoCap: integer('video_cap'), // null = no cap
    maxChannels: integer('max_channels').notNull(),
    allowedPlatforms: text('allowed_platforms').array().notNull(),
    organicOnly: boolean('organic_only').notNull(),
    licenseTextDocumentId: uuid('license_text_document_id').notNull().references(() => legalDocuments.id, { onDelete: 'restrict' }),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('license_terms_versions_tier_version_key').on(t.tier, t.version),
    check('license_terms_versions_tier_check', sql`${t.tier} in ('creator','brand_organic','paid_ad')`),
    check(
      'license_terms_versions_term_check',
      sql`(${t.termKind} = 'perpetual' and ${t.termMonths} is null) or (${t.termKind} = 'fixed_months' and ${t.termMonths} > 0)`,
    ),
    check('license_terms_versions_video_cap_check', sql`${t.videoCap} is null or ${t.videoCap} > 0`),
    check('license_terms_versions_max_channels_check', sql`${t.maxChannels} > 0`),
    check(
      'license_terms_versions_platforms_check',
      sql`cardinality(${t.allowedPlatforms}) > 0 and ${t.allowedPlatforms} <@ array['youtube','instagram','facebook']::text[]`,
    ),
  ],
).enableRLS();

/**
 * One license per order. Only status, revoked_reason, revoked_at and updated_at may change (DB trigger), so the
 * record-hash inputs (PLAN §7) stored here can always be recomputed from this row alone.
 */
export const licenses = pgTable(
  'licenses',
  {
    id: id(),
    publicId: text('public_id').notNull().unique(),
    orderId: uuid('order_id')
      .notNull()
      .unique()
      .references((): AnyPgColumn => orders.id, { onDelete: 'restrict' }),
    trackId: uuid('track_id').notNull().references(() => tracks.id, { onDelete: 'restrict' }),
    trackVersionId: uuid('track_version_id').notNull().references(() => trackVersions.id, { onDelete: 'restrict' }),
    masterSha256: text('master_sha256').notNull(),
    trackTitle: text('track_title').notNull(),
    primaryArtist: text('primary_artist').notNull(),
    tier: text('tier').notNull(),
    termsVersionId: uuid('terms_version_id').notNull().references(() => licenseTermsVersions.id, { onDelete: 'restrict' }),
    licenseTextDocumentId: uuid('license_text_document_id').notNull().references(() => legalDocuments.id, { onDelete: 'restrict' }),
    licenseTextSha256: text('license_text_sha256').notNull(),
    licenseeName: text('licensee_name').notNull(),
    clientName: text('client_name'),
    purchaserOrgId: uuid('purchaser_org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    territory: text('territory').notNull().default('worldwide'),
    editsAllowed: boolean('edits_allowed').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }), // null = perpetual
    invoiceNumber: text('invoice_number').notNull(),
    hashSchema: text('hash_schema').notNull(),
    recordHash: text('record_hash').notNull(),
    status: text('status').notNull().default('active'),
    revokedReason: text('revoked_reason'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    renewsLicenseId: uuid('renews_license_id').references((): AnyPgColumn => licenses.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('licenses_status_check', sql`${t.status} in ('active','expired','revoked')`),
    check('licenses_tier_check', sql`${t.tier} in ('creator','brand_organic','paid_ad')`),
    check('licenses_territory_check', sql`${t.territory} = 'worldwide'`),
    check('licenses_term_check', sql`${t.endsAt} is null or ${t.endsAt} > ${t.startsAt}`),
    check('licenses_record_hash_check', sql`${t.recordHash} ~ '^[0-9a-f]{64}$'`),
    check('licenses_revoked_check', sql`(${t.status} = 'revoked') = (${t.revokedReason} is not null and ${t.revokedAt} is not null)`),
    check(
      'licenses_revoked_reason_check',
      sql`${t.revokedReason} is null or ${t.revokedReason} in ('refund','chargeback_lost','fraud','breach')`,
    ),
    index('licenses_purchaser_idx').on(t.purchaserOrgId),
    index('licenses_track_idx').on(t.trackId),
    index('licenses_expiry_idx').on(t.endsAt).where(sql`${t.status} = 'active' and ${t.endsAt} is not null`),
  ],
).enableRLS();

/** Append-only history of license status changes. */
export const licenseEvents = pgTable(
  'license_events',
  {
    id: id(),
    licenseId: uuid('license_id').notNull().references(() => licenses.id, { onDelete: 'restrict' }),
    fromStatus: text('from_status').notNull(),
    toStatus: text('to_status').notNull(),
    event: text('event').notNull(),
    actorUserId: uuid('actor_user_id'), // null = system
    reason: text('reason'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('license_events_license_idx').on(t.licenseId, t.at)],
).enableRLS();

/** Active channels have removed_at null; their count is capped by the pinned terms' max_channels. */
export const licensedChannels = pgTable(
  'licensed_channels',
  {
    id: id(),
    licenseId: uuid('license_id').notNull().references(() => licenses.id, { onDelete: 'restrict' }),
    platform: text('platform').notNull(),
    handleOrUrl: text('handle_or_url').notNull(),
    externalId: text('external_id'),
    verificationStatus: text('verification_status').notNull().default('unverified'),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
  },
  (t) => [
    check('licensed_channels_platform_check', sql`${t.platform} in ('youtube','instagram','facebook')`),
    check('licensed_channels_verification_check', sql`${t.verificationStatus} in ('unverified','pending','verified')`),
    uniqueIndex('licensed_channels_active_key')
      .on(t.licenseId, t.platform, sql`lower(${t.handleOrUrl})`)
      .where(sql`${t.removedAt} is null`),
    index('licensed_channels_license_idx').on(t.licenseId),
  ],
).enableRLS();

/** One row = one creative (PLAN §5.3); cross-posts and cut-downs add URLs to the same row. */
export const licensedVideos = pgTable(
  'licensed_videos',
  {
    id: id(),
    licenseId: uuid('license_id').notNull().references(() => licenses.id, { onDelete: 'restrict' }),
    label: text('label').notNull(),
    urls: text('urls').array().notNull(),
    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('licensed_videos_urls_check', sql`cardinality(${t.urls}) between 1 and 10`),
    index('licensed_videos_license_idx').on(t.licenseId),
  ],
).enableRLS();

/** Append-only log of clean-file download URLs issued; capped per license (PLAN §13.13). */
export const licenseDownloads = pgTable(
  'license_downloads',
  {
    id: id(),
    licenseId: uuid('license_id').notNull().references(() => licenses.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    file: text('file').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('license_downloads_file_check', sql`${t.file} in ('master','mp3')`), index('license_downloads_license_idx').on(t.licenseId)],
).enableRLS();

// ---- orders (S3-M4) ----

export const ORDER_STATUS_SQL = sql`'created','awaiting_payment','paid','failed','expired','fulfilled','refund_pending','refunded','charged_back_pending','charged_back'`;

/**
 * Money and the purchase facts are a snapshot taken at creation and never change (DB trigger); later code
 * reads them, never the current price book, terms or track. `snapshot` holds the descriptive facts.
 */
export const orders = pgTable(
  'orders',
  {
    id: id(),
    buyerOrgId: uuid('buyer_org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    buyerUserId: uuid('buyer_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    idempotencyKey: text('idempotency_key').notNull(),
    trackId: uuid('track_id').notNull().references(() => tracks.id, { onDelete: 'restrict' }),
    trackVersionId: uuid('track_version_id').notNull().references(() => trackVersions.id, { onDelete: 'restrict' }),
    sellerOrgId: uuid('seller_org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    tier: text('tier').notNull(),
    termsVersionId: uuid('terms_version_id').notNull().references(() => licenseTermsVersions.id, { onDelete: 'restrict' }),
    licenseTextDocumentId: uuid('license_text_document_id').notNull().references(() => legalDocuments.id, { onDelete: 'restrict' }),
    priceBookId: uuid('price_book_id').notNull().references(() => priceBooks.id, { onDelete: 'restrict' }),
    priceLevel: text('price_level').notNull(),
    taxablePaise: bigint('taxable_paise', { mode: 'number' }).notNull(),
    cgstPaise: bigint('cgst_paise', { mode: 'number' }).notNull(),
    sgstPaise: bigint('sgst_paise', { mode: 'number' }).notNull(),
    igstPaise: bigint('igst_paise', { mode: 'number' }).notNull(),
    totalPaise: bigint('total_paise', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('INR'),
    gstRateBps: integer('gst_rate_bps').notNull(),
    royaltyRateBps: integer('royalty_rate_bps').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    gatewayOrderId: text('gateway_order_id').unique(),
    gatewayPaymentId: text('gateway_payment_id').unique(),
    status: text('status').notNull().default('created'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
    fulfilClaimedAt: timestamp('fulfil_claimed_at', { withTimezone: true }),
    fulfilAttempts: integer('fulfil_attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('orders_buyer_idempotency_key').on(t.buyerUserId, t.idempotencyKey),
    check('orders_status_check', sql`${t.status} in (${ORDER_STATUS_SQL})`),
    check('orders_tier_check', sql`${t.tier} in ('creator','brand_organic','paid_ad')`),
    check('orders_currency_check', sql`${t.currency} = 'INR'`),
    check('orders_taxable_check', sql`${t.taxablePaise} > 0`),
    check('orders_total_check', sql`${t.totalPaise} = ${t.taxablePaise} + ${t.cgstPaise} + ${t.sgstPaise} + ${t.igstPaise}`),
    check(
      'orders_gst_split_check',
      sql`(${t.igstPaise} = 0 and ${t.cgstPaise} = ${t.sgstPaise} and ${t.cgstPaise} >= 0) or (${t.cgstPaise} = 0 and ${t.sgstPaise} = 0 and ${t.igstPaise} >= 0)`,
    ),
    check('orders_royalty_rate_check', sql`${t.royaltyRateBps} between 0 and 10000`),
    index('orders_status_idx').on(t.status, t.updatedAt),
    index('orders_buyer_org_idx').on(t.buyerOrgId),
  ],
).enableRLS();

/** Append-only history of order status changes. */
export const orderEvents = pgTable(
  'order_events',
  {
    id: id(),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'restrict' }),
    fromStatus: text('from_status').notNull(),
    toStatus: text('to_status').notNull(),
    event: text('event').notNull(),
    actorUserId: uuid('actor_user_id'), // null = system
    reason: text('reason'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('order_events_order_idx').on(t.orderId, t.at)],
).enableRLS();

// ---- payments (S3-M4) ----

/** Webhook dedupe on Razorpay's event id. Rows only ever gain processed_at (DB trigger). */
export const paymentEvents = pgTable(
  'payment_events',
  {
    id: id(),
    gatewayEventId: text('gateway_event_id').notNull().unique(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [index('payment_events_unprocessed_idx').on(t.receivedAt).where(sql`${t.processedAt} is null`)],
).enableRLS();

/** Daily reconciliation mismatches for the finance queue; one row per (kind, gateway reference). */
export const reconciliationItems = pgTable(
  'reconciliation_items',
  {
    id: id(),
    kind: text('kind').notNull(),
    gatewayRef: text('gateway_ref').notNull(),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'restrict' }),
    details: jsonb('details').notNull().default(sql`'{}'::jsonb`),
    status: text('status').notNull().default('open'),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'restrict' }),
    resolutionNote: text('resolution_note'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('reconciliation_items_kind_ref_key').on(t.kind, t.gatewayRef),
    check('reconciliation_items_kind_check', sql`${t.kind} in ('unknown_payment','captured_not_paid','amount_mismatch','paid_without_capture','duplicate_payment')`),
    check('reconciliation_items_status_check', sql`${t.status} in ('open','resolved')`),
  ],
).enableRLS();

// ---- invoicing (S3-M4) ----

/** Gap-free counters per financial year and kind; row-locked (SELECT … FOR UPDATE) inside the issuing transaction. */
export const invoiceSeries = pgTable(
  'invoice_series',
  {
    fy: text('fy').notNull(),
    kind: text('kind').notNull(),
    nextNumber: integer('next_number').notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.fy, t.kind] }),
    check('invoice_series_kind_check', sql`${t.kind} in ('invoice','credit_note')`),
    check('invoice_series_fy_check', sql`${t.fy} ~ '^[0-9]{4}-[0-9]{2}$'`),
  ],
).enableRLS();

/** Tax invoice issued by the platform. Fiscal columns immutable; pdf_key and e-invoice fields write-once (DB trigger). */
export const invoices = pgTable(
  'invoices',
  {
    id: id(),
    orderId: uuid('order_id').notNull().unique().references(() => orders.id, { onDelete: 'restrict' }),
    number: text('number').notNull().unique(),
    fy: text('fy').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    supplierName: text('supplier_name').notNull(),
    supplierAddress: text('supplier_address').notNull(),
    supplierGstin: text('supplier_gstin').notNull(),
    supplierStateCode: text('supplier_state_code').notNull(),
    recipientName: text('recipient_name').notNull(),
    recipientGstin: text('recipient_gstin'),
    recipientStateCode: text('recipient_state_code').notNull(),
    recipientAddress: text('recipient_address'),
    placeOfSupplyState: text('place_of_supply_state').notNull(),
    sacCode: text('sac_code').notNull(),
    gstRateBps: integer('gst_rate_bps').notNull(),
    taxablePaise: bigint('taxable_paise', { mode: 'number' }).notNull(),
    cgstPaise: bigint('cgst_paise', { mode: 'number' }).notNull(),
    sgstPaise: bigint('sgst_paise', { mode: 'number' }).notNull(),
    igstPaise: bigint('igst_paise', { mode: 'number' }).notNull(),
    totalPaise: bigint('total_paise', { mode: 'number' }).notNull(),
    lineDescription: text('line_description').notNull(),
    pdfKey: text('pdf_key'),
    irn: text('irn'),
    irnAckNo: text('irn_ack_no'),
    signedQr: text('signed_qr'),
    createdAt: createdAt(),
  },
  (t) => [
    check('invoices_number_length_check', sql`char_length(${t.number}) <= 16`),
    check('invoices_total_check', sql`${t.totalPaise} = ${t.taxablePaise} + ${t.cgstPaise} + ${t.sgstPaise} + ${t.igstPaise}`),
  ],
).enableRLS();

// ---- ledger (S3-M4 writes sale royalties; S3-M5 adds the rest) ----

/**
 * Append-only, signed. One entry per (order, kind) and one `payout` debit per payout. A seller's balance at a
 * cutoff is the sum of entries available by then; payout debits are entries too, so nothing is ever updated.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: id(),
    sellerOrgId: uuid('seller_org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull(),
    amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'restrict' }),
    payoutId: uuid('payout_id').references((): AnyPgColumn => payouts.id, { onDelete: 'restrict' }),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [
    check(
      'ledger_entries_kind_check',
      sql`${t.kind} in ('sale_royalty','refund_reversal','chargeback_reversal','clawback','payout','adjustment')`,
    ),
    uniqueIndex('ledger_entries_order_kind_key').on(t.orderId, t.kind).where(sql`${t.orderId} is not null`),
    uniqueIndex('ledger_entries_payout_key').on(t.payoutId).where(sql`${t.kind} = 'payout'`),
    check('ledger_entries_payout_check', sql`(${t.kind} = 'payout') = (${t.payoutId} is not null)`),
    check(
      'ledger_entries_sign_check',
      sql`(${t.kind} = 'sale_royalty' and ${t.amountPaise} >= 0) or (${t.kind} in ('refund_reversal','chargeback_reversal','clawback','payout') and ${t.amountPaise} <= 0) or ${t.kind} = 'adjustment'`,
    ),
    index('ledger_entries_seller_idx').on(t.sellerOrgId, t.availableAt),
  ],
).enableRLS();

// ---- certificates (S3-M4) ----

/** Append-only revisions; a channel change adds a revision. record_hash lives on the license and never changes. */
export const certificates = pgTable(
  'certificates',
  {
    id: id(),
    licenseId: uuid('license_id').notNull().references(() => licenses.id, { onDelete: 'restrict' }),
    revision: integer('revision').notNull(),
    pdfKey: text('pdf_key').notNull(),
    pdfSha256: text('pdf_sha256').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('certificates_license_revision_key').on(t.licenseId, t.revision)],
).enableRLS();

// ---- refunds, credit notes, chargebacks (S3-M5) ----

/**
 * Full refunds only: one per order, amount equal to the order total (DB trigger). The row id is the Razorpay
 * receipt, so a retried refund call cannot refund twice.
 */
export const refunds = pgTable(
  'refunds',
  {
    id: id(),
    orderId: uuid('order_id').notNull().unique().references(() => orders.id, { onDelete: 'restrict' }),
    reason: text('reason').notNull(),
    amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
    gatewayRefundId: text('gateway_refund_id').unique(),
    status: text('status').notNull().default('requested'),
    note: text('note'),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'restrict' }), // null = system
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    lastError: text('last_error'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('refunds_reason_check', sql`${t.reason} in ('claim_not_released','platform_error','invalid_rights','unsellable_at_fulfilment','admin_goodwill')`),
    check('refunds_status_check', sql`${t.status} in ('requested','processing','processed','failed')`),
    check('refunds_amount_check', sql`${t.amountPaise} > 0`),
    index('refunds_status_idx').on(t.status),
  ],
).enableRLS();

/** Reverses an invoice in full. Same immutability as invoices; pdf_key write-once. Own gap-free series (MCN). */
export const creditNotes = pgTable(
  'credit_notes',
  {
    id: id(),
    invoiceId: uuid('invoice_id').notNull().unique().references(() => invoices.id, { onDelete: 'restrict' }),
    refundId: uuid('refund_id').notNull().unique().references(() => refunds.id, { onDelete: 'restrict' }),
    number: text('number').notNull().unique(),
    fy: text('fy').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    reason: text('reason').notNull(),
    taxablePaise: bigint('taxable_paise', { mode: 'number' }).notNull(),
    cgstPaise: bigint('cgst_paise', { mode: 'number' }).notNull(),
    sgstPaise: bigint('sgst_paise', { mode: 'number' }).notNull(),
    igstPaise: bigint('igst_paise', { mode: 'number' }).notNull(),
    totalPaise: bigint('total_paise', { mode: 'number' }).notNull(),
    pdfKey: text('pdf_key'),
    createdAt: createdAt(),
  },
  (t) => [
    check('credit_notes_number_length_check', sql`char_length(${t.number}) <= 16`),
    check('credit_notes_total_check', sql`${t.totalPaise} = ${t.taxablePaise} + ${t.cgstPaise} + ${t.sgstPaise} + ${t.igstPaise}`),
  ],
).enableRLS();

export const chargebacks = pgTable(
  'chargebacks',
  {
    id: id(),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'restrict' }),
    gatewayDisputeId: text('gateway_dispute_id').notNull().unique(),
    status: text('status').notNull().default('open'),
    amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('chargebacks_status_check', sql`${t.status} in ('open','won','lost')`)],
).enableRLS();

// ---- sellers: payout accounts (S3-M5; the seller UI arrives with S4-M7) ----

/** One account per seller org. Changing it needs AAL2 and clears verified_at; payouts wait until re-verified. */
export const payoutAccounts = pgTable('payout_accounts', {
  sellerOrgId: uuid('seller_org_id').primaryKey().references(() => organizations.id, { onDelete: 'restrict' }),
  accountNumberEncrypted: text('account_number_encrypted').notNull(),
  ifsc: text('ifsc').notNull(),
  accountHolderName: text('account_holder_name').notNull(),
  nameMatchStatus: text('name_match_status').notNull().default('unchecked'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  verifiedBy: uuid('verified_by').references(() => users.id, { onDelete: 'restrict' }),
  railRef: text('rail_ref'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

// ---- payouts (S3-M5) ----

export const payoutBatches = pgTable(
  'payout_batches',
  {
    id: id(),
    period: text('period').notNull().unique(),
    cutoffAt: timestamp('cutoff_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('draft'),
    railFileKey: text('rail_file_key'),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'restrict' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('payout_batches_status_check', sql`${t.status} in ('draft','computed','approved','processing','completed')`),
    check('payout_batches_period_check', sql`${t.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  ],
).enableRLS();

/** One line per seller per batch. Amounts are fixed at compute; net = base − TDS + seller GST. */
export const payouts = pgTable(
  'payouts',
  {
    id: id(),
    batchId: uuid('batch_id').notNull().references(() => payoutBatches.id, { onDelete: 'restrict' }),
    sellerOrgId: uuid('seller_org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    royaltyBasePaise: bigint('royalty_base_paise', { mode: 'number' }).notNull(),
    tdsPaise: bigint('tds_paise', { mode: 'number' }).notNull(),
    sellerGstPaise: bigint('seller_gst_paise', { mode: 'number' }).notNull(),
    rcmGstPaise: bigint('rcm_gst_paise', { mode: 'number' }).notNull(),
    netPaise: bigint('net_paise', { mode: 'number' }).notNull(),
    rail: text('rail').notNull(),
    railRef: text('rail_ref'),
    utr: text('utr'),
    failureReason: text('failure_reason'),
    status: text('status').notNull().default('pending'),
    statementPdfKey: text('statement_pdf_key'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('payouts_batch_seller_key').on(t.batchId, t.sellerOrgId),
    check('payouts_status_check', sql`${t.status} in ('pending','processing','paid','failed')`),
    check('payouts_rail_check', sql`${t.rail} in ('bank_file','razorpayx')`),
    check('payouts_amounts_check', sql`${t.royaltyBasePaise} > 0 and ${t.tdsPaise} >= 0 and ${t.sellerGstPaise} >= 0 and ${t.rcmGstPaise} >= 0`),
    check('payouts_net_check', sql`${t.netPaise} = ${t.royaltyBasePaise} - ${t.tdsPaise} + ${t.sellerGstPaise}`),
  ],
).enableRLS();

// ---- clearance, disputes, complaints, enquiries (S3-M6) ----

export const CLEARANCE_STATUS_SQL = sql`'not_required','pending','sent','completed','failed','overdue','escalated'`;

/** Bio-code proof that the buyer controls a licensed channel (PLAN §11 ChannelVerifier). One pending challenge per channel. */
export const channelVerifications = pgTable(
  'channel_verifications',
  {
    id: id(),
    licensedChannelId: uuid('licensed_channel_id').notNull().references(() => licensedChannels.id, { onDelete: 'restrict' }),
    method: text('method').notNull(),
    code: text('code').notNull(),
    status: text('status').notNull().default('pending'),
    checkedBy: uuid('checked_by').references(() => users.id, { onDelete: 'restrict' }), // admin who confirmed it by hand; null = automatic
    checkedAt: timestamp('checked_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: createdAt(),
  },
  (t) => [
    check('channel_verifications_method_check', sql`${t.method} in ('bio_code','oauth_google','oauth_meta')`),
    check('channel_verifications_status_check', sql`${t.status} in ('pending','verified','failed')`),
    uniqueIndex('channel_verifications_pending_key').on(t.licensedChannelId).where(sql`${t.status} = 'pending'`),
  ],
).enableRLS();

/**
 * One request per licensed channel and per registered video (PLAN §4.5). The response token is stored as a
 * SHA-256 hash and cleared when used; `clearance_class` is the track's class when the request was made.
 */
export const clearanceRequests = pgTable(
  'clearance_requests',
  {
    id: id(),
    licenseId: uuid('license_id').notNull().references(() => licenses.id, { onDelete: 'restrict' }),
    licensedChannelId: uuid('licensed_channel_id').references(() => licensedChannels.id, { onDelete: 'restrict' }),
    licensedVideoId: uuid('licensed_video_id').references(() => licensedVideos.id, { onDelete: 'restrict' }),
    sellerOrgId: uuid('seller_org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    provider: text('provider').notNull().default('manual_seller'),
    scope: text('scope').notNull(),
    clearanceClass: text('clearance_class').notNull(),
    status: text('status').notNull(),
    respondTokenHash: text('respond_token_hash'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    dueAt: timestamp('due_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    sellerNote: text('seller_note'),
    evidenceKey: text('evidence_key'), // reserved: evidence upload arrives with the seller portal (S4-M7)
    externalRef: text('external_ref'),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('clearance_requests_status_check', sql`${t.status} in (${CLEARANCE_STATUS_SQL})`),
    check('clearance_requests_provider_check', sql`${t.provider} in ('manual_seller')`),
    check(
      'clearance_requests_scope_check',
      sql`(${t.scope} = 'channel' and ${t.licensedChannelId} is not null and ${t.licensedVideoId} is null) or (${t.scope} = 'video' and ${t.licensedVideoId} is not null and ${t.licensedChannelId} is null)`,
    ),
    check('clearance_requests_class_check', sql`${t.clearanceClass} in ('A','B')`),
    uniqueIndex('clearance_requests_channel_key').on(t.licensedChannelId).where(sql`${t.licensedChannelId} is not null`),
    uniqueIndex('clearance_requests_video_key').on(t.licensedVideoId).where(sql`${t.licensedVideoId} is not null`),
    uniqueIndex('clearance_requests_token_key').on(t.respondTokenHash).where(sql`${t.respondTokenHash} is not null`),
    index('clearance_requests_status_idx').on(t.status, t.dueAt),
    index('clearance_requests_license_idx').on(t.licenseId),
    index('clearance_requests_seller_idx').on(t.sellerOrgId, t.status),
  ],
).enableRLS();

export const DISPUTE_STATUS_SQL = sql`'open','in_progress','resolved_released','resolved_denied','refund_eligible','resolved_refunded','resolved_kit_issued'`;

/** A buyer's report of a claim or strike against a registered use (PLAN §4.6). Timers are fixed at open. */
export const disputes = pgTable(
  'disputes',
  {
    id: id(),
    licenseId: uuid('license_id').notNull().references(() => licenses.id, { onDelete: 'restrict' }),
    openedBy: uuid('opened_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    videoUrl: text('video_url').notNull(),
    platform: text('platform').notNull(),
    disputeType: text('dispute_type').notNull(),
    claimantName: text('claimant_name').notNull(),
    claimantCataloged: boolean('claimant_cataloged').notNull().default(false), // admin: the claimant is a rightsholder in our catalog
    clearanceClassAtOpen: text('clearance_class_at_open').notNull(),
    status: text('status').notNull().default('open'),
    firstActionDueAt: timestamp('first_action_due_at', { withTimezone: true }).notNull(),
    resolutionDueAt: timestamp('resolution_due_at', { withTimezone: true }), // null outside Class A/B
    refundEligibleAt: timestamp('refund_eligible_at', { withTimezone: true }).notNull(),
    overdueNotifiedAt: timestamp('overdue_notified_at', { withTimezone: true }),
    resolution: text('resolution'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('disputes_status_check', sql`${t.status} in (${DISPUTE_STATUS_SQL})`),
    check('disputes_platform_check', sql`${t.platform} in ('youtube','instagram','facebook')`),
    check('disputes_type_check', sql`${t.disputeType} in ('content_id_claim','copyright_strike','mute','ad_rejection','other')`),
    check('disputes_class_check', sql`${t.clearanceClassAtOpen} in ('A','B','C','unclassified')`),
    // The same claim reported twice while the first is still being worked is one dispute.
    uniqueIndex('disputes_open_claim_key')
      .on(t.licenseId, t.videoUrl, t.disputeType)
      .where(sql`${t.status} in ('open','in_progress')`),
    index('disputes_status_idx').on(t.status, t.firstActionDueAt),
    index('disputes_license_idx').on(t.licenseId),
  ],
).enableRLS();

export const disputeEvents = pgTable(
  'dispute_events',
  {
    id: id(),
    disputeId: uuid('dispute_id').notNull().references(() => disputes.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull(),
    note: text('note'),
    actorUserId: uuid('actor_user_id'), // null = system
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('dispute_events_dispute_idx').on(t.disputeId, t.at)],
).enableRLS();

/** Public third-party copyright complaints (PLAN §5.5). */
export const copyrightComplaints = pgTable(
  'copyright_complaints',
  {
    id: id(),
    complainantName: text('complainant_name').notNull(),
    complainantEmail: text('complainant_email').notNull(),
    trackId: uuid('track_id').references(() => tracks.id, { onDelete: 'restrict' }),
    workClaimed: text('work_claimed').notNull(),
    evidenceKey: text('evidence_key'), // reserved: evidence upload arrives with the public form (S4)
    status: text('status').notNull().default('received'),
    grievanceOfficerId: uuid('grievance_officer_id').references(() => users.id, { onDelete: 'restrict' }),
    outcomeNote: text('outcome_note'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [
    check('copyright_complaints_status_check', sql`${t.status} in ('received','investigating','upheld','rejected')`),
    index('copyright_complaints_status_idx').on(t.status, t.receivedAt),
  ],
).enableRLS();

/** Commercial/Broadcast enquiries (PLAN §6.1): no checkout, no license record. */
export const enquiries = pgTable(
  'enquiries',
  {
    id: id(),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'restrict' }),
    contactName: text('contact_name').notNull(),
    contactEmail: text('contact_email').notNull(),
    contactPhone: text('contact_phone'),
    trackId: uuid('track_id').notNull().references(() => tracks.id, { onDelete: 'restrict' }),
    intendedUse: text('intended_use').notNull(),
    media: text('media').notNull(),
    budgetRange: text('budget_range'),
    status: text('status').notNull().default('new'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('enquiries_media_check', sql`${t.media} in ('tv','ott','cinema','other')`),
    check('enquiries_status_check', sql`${t.status} in ('new','contacted','closed_won','closed_lost')`),
    index('enquiries_status_idx').on(t.status, t.createdAt),
  ],
).enableRLS();

// ---- seller onboarding (S4-M7) ----

/**
 * KYC documents a seller uploads at onboarding (PAN card, ID, GST certificate, bank proof). Private bucket, checked
 * like rights documents (PLAN F9), shown to admins only as attachment downloads. Rows are never deleted: a corrected
 * document is a new row.
 */
export const sellerDocuments = pgTable(
  'seller_documents',
  {
    id: id(),
    sellerOrgId: uuid('seller_org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull(),
    declaredMime: text('declared_mime').notNull(),
    fileKey: text('file_key').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    validationStatus: text('validation_status').notNull().default('pending'),
    validationError: text('validation_error'),
    uploadedBy: uuid('uploaded_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('seller_documents_kind_check', sql`${t.kind} in ('pan_card','id_proof','gst_certificate','bank_proof')`),
    check('seller_documents_validation_status_check', sql`${t.validationStatus} in ('pending','valid','rejected')`),
    index('seller_documents_org_idx').on(t.sellerOrgId, t.uploadedAt),
  ],
).enableRLS();

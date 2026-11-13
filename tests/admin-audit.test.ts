import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TransactionRollbackError, eq, sql } from 'drizzle-orm';
import { acceptances, auditLog, clearanceRequests, licensedChannels, payoutBatches, payouts, reconciliationItems, rightsDocuments, screenings, sellerDocuments } from '@/db/schema';
import { createPriceBook, activatePriceBook } from '@/lib/pricing/server';
import { adminRevokeLicense, publishTermsVersion } from '@/lib/licensing/server';
import { getCurrentDocument, publishLegalDocument } from '@/lib/legal/server';
import { createTaxonomyItem, setTaxonomyActive, approveTrack, rejectTrack, reclassifyTrack, rightsDocumentDownloadUrl, setTrackAvailability } from '@/lib/catalog/server';
import { adminConfirmChannel, escalateClearance, resendClearance, resolveClearance, startBioCodeVerification } from '@/lib/clearance/server';
import { openDispute, recordFirstAction, requestDisputeRefund, resolveComplaint, resolveDispute, setClaimantCataloged, startInvestigation, submitCopyrightComplaint, makeRefundEligible } from '@/lib/disputes/server';
import { submitEnquiry, setEnquiryStatus } from '@/lib/enquiries/server';
import type { AdminContext, AdminPermission } from '@/lib/identity/server';
import { executeRefund, requestRefund } from '@/lib/orders/server';
import { refundCreditNoteUrl, resolveReconciliationItem, retryRefund } from '@/lib/payments/server';
import { approvePayoutBatch, computePayoutBatch, payoutBankFileUrl, payoutStatementUrl, previousPeriod, recordPayoutFailed, recordPayoutPaid, submitPayoutBatch } from '@/lib/payouts/server';
import { closeDb, getDb, type Db } from '@/lib/platform/db';
import { recordClaimProbe } from '@/lib/screening/server';
import { setKycStatus, setPayoutAccount, sellerDocumentDownloadUrl, verifyPayoutAccount } from '@/lib/sellers/server';
import { adminCtx, sale, setupCommerce } from './commerce';
import { makeSeller, makeSellableTrack } from './factories';
import { FakeGateway, MemoryStore } from './fakes';
import { ADMIN_CALLS } from './admin-calls';

// Signed links need Supabase Storage, which does not exist in tests; the audit row is what is under test.
vi.mock('@/lib/platform/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/platform/storage')>()),
  createSignedDownloadUrl: async () => 'https://signed.example/file',
}));

afterAll(closeDb);
const db = getDb();
const gw = new FakeGateway();
const store = new MemoryStore();
beforeAll(() => setupCommerce(db, { L1: 100_000, L2: 100_000, L3: 100_000, L4: 100_000, L5: 100_000 }));

type Scenario = (tx: Db, as: (...p: AdminPermission[]) => Promise<AdminContext>) => Promise<{ admin: AdminContext; act: () => Promise<unknown> }>;

const rupees = (n: number) => n * 100;

/** A fully priced grid for a new price book. */
const grid = () => (['L1', 'L2', 'L3', 'L4', 'L5'] as const).flatMap((priceLevel) => (['creator', 'brand_organic', 'paid_ad'] as const).map((tier) => ({ priceLevel, tier, amountPaise: rupees(1000) })));

/** A batch with one seller line in the given states, inserted directly: compute needs a month that has ended and ordering against every other test's batches. */
async function batchWithLine(tx: Db, opts: { batch?: string; line?: string; railFileKey?: string; statementKey?: string } = {}) {
  const seller = await makeSeller(tx);
  const year = 1900 + Math.floor(Math.random() * 40);
  const [batch] = await tx.insert(payoutBatches).values({ period: `${year}-0${1 + Math.floor(Math.random() * 9)}`, cutoffAt: new Date(`${year}-12-01T00:00:00Z`), status: opts.batch ?? 'computed', railFileKey: opts.railFileKey ?? null }).returning();
  const [line] = await tx
    .insert(payouts)
    .values({ batchId: batch!.id, sellerOrgId: seller.orgId, royaltyBasePaise: 100_000, tdsPaise: 0, sellerGstPaise: 0, rcmGstPaise: 0, netPaise: 100_000, rail: 'bank_file', status: opts.line ?? 'pending', statementPdfKey: opts.statementKey ?? null })
    .returning();
  return { batch: batch!, line: line!, seller };
}

const claim = () => ({ videoUrl: `https://youtube.com/watch?v=${Math.random().toString(36).slice(2)}`, platform: 'youtube' as const, disputeType: 'content_id_claim' as const, claimantName: 'Some Label' });
async function openedDispute(tx: Db) {
  const s = await sale(tx, gw, store);
  const r = await openDispute(tx, { userId: s.buyer.owner.userId, orgId: s.buyer.orgId }, s.licenseId!, claim());
  if (!r.ok) throw new Error(r.issues.join());
  return { s, disputeId: r.value.disputeId };
}
const classBRequest = async (tx: Db) => {
  const s = await sale(tx, gw, store, { clearanceClass: 'B' });
  const [r] = await tx.select().from(clearanceRequests).where(eq(clearanceRequests.licenseId, s.licenseId!));
  return { s, request: r! };
};
/** A track in review with a ready version, a finished screening and a claim probe: everything approval asks for. */
async function trackInReview(tx: Db, as: Parameters<Scenario>[1]) {
  const t = await makeSellableTrack(tx, { status: 'in_review' });
  await tx.insert(screenings).values({ trackVersionId: t.trackVersionId, provider: 'test', status: 'clean' });
  const verifier = await as('verification');
  await recordClaimProbe(tx, verifier, { versionId: t.trackVersionId, platform: 'youtube', claims: [] });
  return { t, verifier };
}
async function processedRefund(tx: Db, finance: AdminContext) {
  const s = await sale(tx, gw, store);
  const r = await requestRefund(tx, finance, s.orderId, { reason: 'admin_goodwill' });
  if (!r.ok) throw new Error(r.reason);
  expect(await executeRefund(tx, r.refundId, { gateway: gw, store })).toBe('processed');
  return r.refundId;
}

/**
 * One scenario per mutating admin call: it builds the state the call needs and returns the call to make. The test
 * runs it inside a transaction that is rolled back, so nothing is left in the shared database.
 */
const SCENARIOS: Record<string, Scenario> = {
  'clearance.escalate': async (tx, as) => {
    const { request } = await classBRequest(tx);
    await tx.update(clearanceRequests).set({ status: 'overdue' }).where(eq(clearanceRequests.id, request.id));
    const admin = await as('clearance');
    return { admin, act: () => escalateClearance(tx, admin, request.id) };
  },
  'clearance.resolve': async (tx, as) => {
    const { request } = await classBRequest(tx);
    const admin = await as('clearance');
    return { admin, act: () => resolveClearance(tx, admin, request.id, { outcome: 'released', note: 'seller confirmed by phone' }) };
  },
  'clearance.resend': async (tx, as) => {
    const { request } = await classBRequest(tx);
    const admin = await as('clearance');
    return { admin, act: () => resendClearance(tx, admin, request.id) };
  },
  'channels.confirm': async (tx, as) => {
    const { s } = await classBRequest(tx);
    const [ch] = await tx.select().from(licensedChannels).where(eq(licensedChannels.licenseId, s.licenseId!));
    await startBioCodeVerification(tx, { userId: s.buyer.owner.userId, orgId: s.buyer.orgId }, ch!.id);
    const admin = await as('clearance');
    return { admin, act: () => adminConfirmChannel(tx, admin, ch!.id) };
  },
  'disputes.first_action': async (tx, as) => {
    const { disputeId } = await openedDispute(tx);
    const admin = await as('disputes');
    return { admin, act: () => recordFirstAction(tx, admin, disputeId, { note: 'called the claimant' }) };
  },
  'disputes.resolve': async (tx, as) => {
    const { disputeId } = await openedDispute(tx);
    const admin = await as('disputes');
    await recordFirstAction(tx, admin, disputeId, { note: 'called the claimant' });
    return { admin, act: () => resolveDispute(tx, admin, disputeId, { resolution: 'released', note: 'claim released by the claimant' }) };
  },
  'disputes.claimant_cataloged': async (tx, as) => {
    const { disputeId } = await openedDispute(tx);
    const admin = await as('disputes');
    return { admin, act: () => setClaimantCataloged(tx, admin, disputeId, true) };
  },
  'disputes.request_refund': async (tx, as) => {
    const { disputeId } = await openedDispute(tx);
    await makeRefundEligible(tx, 50, { now: new Date(Date.now() + 40 * 86_400_000), only: disputeId });
    const admin = await as('finance');
    return { admin, act: () => requestDisputeRefund(tx, admin, disputeId) };
  },
  'complaints.investigate': async (tx, as) => {
    const r = await submitCopyrightComplaint(tx, { complainantName: 'A Label', complainantEmail: 'legal@label.example', workClaimed: 'My song, copied without a license' }, { ip: null });
    if (!r.ok) throw new Error(r.issues.join());
    const admin = await as('disputes');
    return { admin, act: () => startInvestigation(tx, admin, r.reference) };
  },
  'complaints.resolve': async (tx, as) => {
    const r = await submitCopyrightComplaint(tx, { complainantName: 'A Label', complainantEmail: 'legal@label.example', workClaimed: 'My song, copied without a license' }, { ip: null });
    if (!r.ok) throw new Error(r.issues.join());
    const admin = await as('disputes');
    return { admin, act: () => resolveComplaint(tx, admin, r.reference, { outcome: 'rejected', note: 'not our work' }) };
  },
  'licenses.revoke': async (tx, as) => {
    const s = await sale(tx, gw, store);
    const admin = await as('disputes');
    return { admin, act: () => adminRevokeLicense(tx, admin, s.licenseId!, { reason: 'fraud', note: 'stolen card' }) };
  },
  'refunds.request': async (tx, as) => {
    const s = await sale(tx, gw, store);
    const admin = await as('finance');
    return { admin, act: () => requestRefund(tx, admin, s.orderId, { reason: 'admin_goodwill' }) };
  },
  'refunds.retry': async (tx, as) => {
    const s = await sale(tx, gw, store);
    const admin = await as('finance');
    const r = await requestRefund(tx, admin, s.orderId, { reason: 'admin_goodwill' });
    if (!r.ok) throw new Error(r.reason);
    return { admin, act: () => retryRefund(tx, admin, r.refundId) };
  },
  'refunds.credit_note': async (tx, as) => {
    const admin = await as('finance');
    const refundId = await processedRefund(tx, admin);
    return { admin, act: () => refundCreditNoteUrl(tx, admin, refundId) };
  },
  'payouts.compute': async (tx, as) => {
    // Other test files leave batches behind and periods run in order: push them into the past inside this rolled-back transaction.
    await tx.execute(sql`SET LOCAL session_replication_role = replica`);
    await tx.execute(sql`UPDATE payout_batches b SET period = (1000 + x.n)::text || '-01', cutoff_at = '2000-01-01' FROM (SELECT id, row_number() OVER () AS n FROM payout_batches) x WHERE x.id = b.id`);
    await tx.execute(sql`SET LOCAL session_replication_role = origin`);
    const admin = await as('finance');
    return { admin, act: () => computePayoutBatch(tx, admin, previousPeriod(new Date())) };
  },
  'payouts.approve': async (tx, as) => {
    const { batch } = await batchWithLine(tx);
    const admin = await as('finance');
    return { admin, act: () => approvePayoutBatch(tx, admin, batch.id) };
  },
  'payouts.submit': async (tx, as) => {
    const { batch } = await batchWithLine(tx, { batch: 'approved' });
    const admin = await as('finance');
    return { admin, act: () => submitPayoutBatch(tx, admin, batch.id, { id: 'bank_file', submit: async () => ({ railRef: 'bank/file.csv' }) }) };
  },
  'payouts.bank_file': async (tx, as) => {
    const { batch } = await batchWithLine(tx, { batch: 'processing', railFileKey: 'payouts/x/file.csv' });
    const admin = await as('finance');
    return { admin, act: () => payoutBankFileUrl(tx, admin, batch.id) };
  },
  'payouts.record_paid': async (tx, as) => {
    const { line } = await batchWithLine(tx, { batch: 'processing', line: 'processing' });
    const admin = await as('finance');
    return { admin, act: () => recordPayoutPaid(tx, admin, line.id, 'UTR1234567') };
  },
  'payouts.record_failed': async (tx, as) => {
    const { line } = await batchWithLine(tx, { batch: 'processing', line: 'processing' });
    const admin = await as('finance');
    return { admin, act: () => recordPayoutFailed(tx, admin, line.id, 'account closed') };
  },
  'payouts.statement': async (tx, as) => {
    const { line } = await batchWithLine(tx, { batch: 'completed', line: 'paid', statementKey: 'statements/x/y.pdf' });
    const admin = await as('finance');
    return { admin, act: () => payoutStatementUrl(tx, admin, line.id) };
  },
  'payouts.verify_account': async (tx, as) => {
    const seller = await makeSeller(tx);
    await setPayoutAccount(tx, { ...seller.owner, aal: 'aal2' }, seller.orgId, { accountNumber: '123456789012', ifsc: 'HDFC0001234', accountHolderName: 'Seller Pvt Ltd' });
    const admin = await as('finance');
    return { admin, act: () => verifyPayoutAccount(tx, admin, seller.orgId, true) };
  },
  'reconciliation.resolve': async (tx, as) => {
    const [item] = await tx.insert(reconciliationItems).values({ kind: 'unknown_payment', gatewayRef: `pay_${crypto.randomUUID()}` }).returning();
    const admin = await as('finance');
    return { admin, act: () => resolveReconciliationItem(tx, admin, item!.id, 'refunded in the dashboard') };
  },
  'enquiries.set_status': async (tx, as) => {
    const t = await makeSellableTrack(tx);
    const r = await submitEnquiry(tx, { trackId: t.trackId, contactName: 'Priya Rao', contactEmail: `p-${Math.random().toString(36).slice(2)}@studio.example`, intendedUse: 'Title track for a streaming series, 8 episodes.', media: 'ott' }, { ip: `192.0.2.${Math.floor(Math.random() * 250)}` });
    if (!r.ok) throw new Error(r.issues.join());
    const admin = await as('disputes');
    return { admin, act: () => setEnquiryStatus(tx, admin, r.id, 'contacted') };
  },
  'catalog.approve': async (tx, as) => {
    const { t, verifier } = await trackInReview(tx, as);
    return { admin: verifier, act: () => approveTrack(tx, verifier, { trackId: t.trackId, clearanceClass: 'A', priceLevel: 'L1' }) };
  },
  'catalog.reject': async (tx, as) => {
    const { t, verifier } = await trackInReview(tx, as);
    return { admin: verifier, act: () => rejectTrack(tx, verifier, { trackId: t.trackId, reason: 'audio quality is too low' }) };
  },
  'catalog.probe': async (tx, as) => {
    const t = await makeSellableTrack(tx, { status: 'in_review' });
    const admin = await as('verification');
    return { admin, act: () => recordClaimProbe(tx, admin, { versionId: t.trackVersionId, platform: 'youtube', claims: [] }) };
  },
  'catalog.availability': async (tx, as) => {
    const t = await makeSellableTrack(tx);
    const admin = await as('verification');
    return { admin, act: () => setTrackAvailability(tx, admin, { trackId: t.trackId, action: 'suspend', reason: 'rights query' }) };
  },
  'catalog.reclassify': async (tx, as) => {
    const t = await makeSellableTrack(tx);
    const admin = await as('verification');
    return { admin, act: () => reclassifyTrack(tx, admin, { trackId: t.trackId, to: 'C', reason: 'claim found' }) };
  },
  'catalog.rights_document': async (tx, as) => {
    const t = await makeSellableTrack(tx);
    const [doc] = await tx.insert(rightsDocuments).values({ trackId: t.trackId, sellerOrgId: t.sellerOrgId, docType: 'distribution_agreement', declaredMime: 'application/pdf', fileKey: `${t.trackId}/doc.pdf`, validationStatus: 'valid' }).returning();
    const admin = await as('verification');
    return { admin, act: () => rightsDocumentDownloadUrl(tx, admin, doc!.id) };
  },
  'taxonomy.create': async (tx, as) => {
    const admin = await as('verification');
    return { admin, act: () => createTaxonomyItem(tx, admin, { kind: 'genre', name: `Genre ${crypto.randomUUID()}` }) };
  },
  'taxonomy.set_active': async (tx, as) => {
    const admin = await as('verification');
    await createTaxonomyItem(tx, admin, { kind: 'mood', name: `Mood ${crypto.randomUUID()}` });
    const { moods } = await import('@/db/schema');
    const [m] = await tx.select().from(moods).orderBy(moods.name).limit(1);
    return { admin, act: () => setTaxonomyActive(tx, admin, { kind: 'mood', id: m!.id, active: !m!.active }) };
  },
  'pricing.create': async (tx, as) => {
    const admin = await as('verification');
    return { admin, act: () => createPriceBook(tx, admin, grid()) };
  },
  'pricing.activate': async (tx, as) => {
    const admin = await as('verification');
    const book = await createPriceBook(tx, admin, grid());
    return { admin, act: () => activatePriceBook(tx, admin, book.id) };
  },
  'kyc.set_status': async (tx, as) => {
    const seller = await makeSeller(tx);
    const admin = await as('verification');
    return { admin, act: () => setKycStatus(tx, admin, seller.orgId, 'rejected', 'the PAN card is unreadable') };
  },
  'kyc.document': async (tx, as) => {
    const seller = await makeSeller(tx);
    const [doc] = await tx.insert(sellerDocuments).values({ sellerOrgId: seller.orgId, kind: 'pan_card', declaredMime: 'application/pdf', fileKey: `${seller.orgId}/pan.pdf`, validationStatus: 'valid', uploadedBy: seller.owner.userId }).returning();
    const admin = await as('verification');
    return { admin, act: () => sellerDocumentDownloadUrl(tx, admin, doc!.id) };
  },
  'legal.publish': async (tx, as) => {
    const admin = await as('superadmin');
    return { admin, act: () => publishLegalDocument(tx, admin, { kind: 'seller_agreement', bodyMarkdown: 'Seller agreement, test version.' }) };
  },
  'terms.publish': async (tx, as) => {
    const admin = await as('superadmin');
    const text = await getCurrentDocument(tx, 'license_creator');
    return { admin, act: () => publishTermsVersion(tx, admin, { tier: 'creator', termKind: 'perpetual', termMonths: null, videoCap: null, maxChannels: 2, allowedPlatforms: ['youtube'], organicOnly: true, licenseTextDocumentId: text!.id }) };
  },
};

/** Runs `body` in a transaction that is always rolled back. */
async function rolledBack(body: (tx: Db) => Promise<void>) {
  await db
    .transaction(async (tx) => {
      await body(tx as unknown as Db);
      tx.rollback();
    })
    .catch((e: unknown) => {
      if (!(e instanceof TransactionRollbackError)) throw e;
    });
}

/** The audit action each call writes: a row with this action, naming the admin and an entity, must appear. */
const EXPECTED_ACTION: Record<string, string> = {
  'clearance.escalate': 'clearance.escalate',
  'clearance.resolve': 'clearance.complete',
  'clearance.resend': 'clearance.resend',
  'channels.confirm': 'channel.verify',
  'disputes.first_action': 'dispute.first_action',
  'disputes.resolve': 'dispute.release',
  'disputes.claimant_cataloged': 'dispute.claimant_cataloged',
  'disputes.request_refund': 'refund.requested',
  'complaints.investigate': 'complaint.investigate',
  'complaints.resolve': 'complaint.rejected',
  'licenses.revoke': 'license.revoke',
  'refunds.request': 'refund.requested',
  'refunds.retry': 'refund.retry',
  'refunds.credit_note': 'refund.download_credit_note',
  'payouts.compute': 'payout_batch.compute',
  'payouts.approve': 'payout_batch.approve',
  'payouts.submit': 'payout_batch.submit',
  'payouts.bank_file': 'payout_batch.download_bank_file',
  'payouts.record_paid': 'payout.paid',
  'payouts.record_failed': 'payout.failed',
  'payouts.statement': 'payout.download_statement',
  'payouts.verify_account': 'payout_account.verify',
  'reconciliation.resolve': 'reconciliation.resolve',
  'enquiries.set_status': 'enquiry.status',
  'catalog.approve': 'track.approve',
  'catalog.reject': 'track.reject',
  'catalog.probe': 'claim_probe.record',
  'catalog.availability': 'track.suspend',
  'catalog.reclassify': 'track.reclassify',
  'catalog.rights_document': 'rights_document.download',
  'taxonomy.create': 'genre.create',
  'taxonomy.set_active': 'mood.set_active',
  'pricing.create': 'price_book.create',
  'pricing.activate': 'price_book.activate',
  'kyc.set_status': 'seller.kyc_rejected',
  'kyc.document': 'seller_document.download',
  'legal.publish': 'legal_document.publish',
  'terms.publish': 'license_terms.publish',
};

/** Other branches of a call that write a differently named row (the base scenario covers one branch only). */
const VARIANTS: { label: string; action: string; scenario: Scenario }[] = [
  {
    label: 'catalog.availability reinstate',
    action: 'track.reinstate',
    scenario: async (tx, as) => {
      const t = await makeSellableTrack(tx, { status: 'suspended' });
      const admin = await as('verification');
      return { admin, act: () => setTrackAvailability(tx, admin, { trackId: t.trackId, action: 'reinstate', reason: 'claim withdrawn' }) };
    },
  },
  {
    label: 'catalog.availability delist',
    action: 'track.delist',
    scenario: async (tx, as) => {
      const t = await makeSellableTrack(tx);
      const admin = await as('verification');
      return { admin, act: () => setTrackAvailability(tx, admin, { trackId: t.trackId, action: 'delist', reason: 'label request' }) };
    },
  },
  {
    label: 'catalog.reclassify A to B',
    action: 'track.reclassify',
    scenario: async (tx, as) => {
      const t = await makeSellableTrack(tx);
      const doc = (await getCurrentDocument(tx, 'release_commitment')) ?? (await publishLegalDocument(tx, await as('superadmin'), { kind: 'release_commitment', bodyMarkdown: 'Release commitment, test version.' }));
      await tx.insert(acceptances).values({ userId: (await makeSeller(tx)).owner.userId, orgId: t.sellerOrgId, legalDocumentId: doc.id });
      const admin = await as('verification');
      return { admin, act: () => reclassifyTrack(tx, admin, { trackId: t.trackId, to: 'B', reason: 'registered with a rights manager' }) };
    },
  },
];

const mutating = ADMIN_CALLS.filter((c) => c.mutates).map((c) => c.name);

/** Runs a scenario and asserts the new audit rows include `action`, written by the admin, with an entity id. */
async function expectAudit(label: string, action: string, scenario: Scenario) {
  await rolledBack(async (tx) => {
    const { admin, act } = await scenario(tx, async (...permissions) => adminCtx(tx, permissions));
    const before = await tx.select().from(auditLog).where(eq(auditLog.actorUserId, admin.userId));
    await act();
    const added = (await tx.select().from(auditLog).where(eq(auditLog.actorUserId, admin.userId))).slice(before.length);
    const row = added.find((r) => r.action === action);
    expect(row, `${label}: expected an audit row "${action}" for the admin, got [${added.map((r) => r.action).join(', ')}]`).toBeDefined();
    expect(row!.entityType).toBeTruthy();
    expect(row!.entityId).toBeTruthy();
  });
}

describe('every admin mutation writes an audit entry (PLAN §12, S4-M10)', () => {
  it('has a scenario and an expected action for each mutating admin call and none for a call that no longer exists', () => {
    expect(mutating.filter((n) => !(n in SCENARIOS)), 'mutating calls without an audit scenario').toEqual([]);
    expect(mutating.filter((n) => !(n in EXPECTED_ACTION)), 'mutating calls without an expected audit action').toEqual([]);
    expect(Object.keys(SCENARIOS).filter((n) => !mutating.includes(n)), 'scenarios for calls that are not in ADMIN_CALLS as mutating').toEqual([]);
  });

  it.each(mutating.map((n) => [n] as const))('%s writes its audit_log row naming the admin', (name) => expectAudit(name, EXPECTED_ACTION[name]!, SCENARIOS[name]!));

  it.each(VARIANTS.map((v) => [v.label, v] as const))('%s writes its audit_log row naming the admin', (label, v) => expectAudit(label, v.action, v.scenario));
});

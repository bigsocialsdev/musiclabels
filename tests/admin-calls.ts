import { listAuditLog } from '@/lib/audit/server';
import { approveTrack, createTaxonomyItem, listAdminTracks, listTaxonomyAdmin, reclassifyTrack, rejectTrack, rightsDocumentDownloadUrl, setTaxonomyActive, setTrackAvailability } from '@/lib/catalog/server';
import { adminConfirmChannel, escalateClearance, listClearanceQueue, resendClearance, resolveClearance } from '@/lib/clearance/server';
import { getDisputeDetail, listComplaints, listRefundEligibleDisputes, listDisputes, recordFirstAction, requestDisputeRefund, resolveComplaint, resolveDispute, setClaimantCataloged, startInvestigation } from '@/lib/disputes/server';
import { listEnquiries, setEnquiryStatus } from '@/lib/enquiries/server';
import { listLegalDocuments, publishLegalDocument } from '@/lib/legal/server';
import { adminRevokeLicense, publishTermsVersion } from '@/lib/licensing/server';
import { requestRefund } from '@/lib/orders/server';
import { activatePriceBook, createPriceBook, listPriceBooks } from '@/lib/pricing/server';
import { recordClaimProbe } from '@/lib/screening/server';
import { sellerDocumentDownloadUrl, setKycStatus, verifyPayoutAccount } from '@/lib/sellers/server';
import type { AdminContext, AdminPermission } from '@/lib/identity/server';
import { listReconciliationItems, listRefunds, refundCreditNoteUrl, resolveReconciliationItem, retryRefund } from '@/lib/payments/server';
import { approvePayoutBatch, computePayoutBatch, getPayoutBatchDetail, listPayoutBatches, payoutBankFileUrl, payoutStatementUrl, recordPayoutFailed, recordPayoutPaid, submitPayoutBatch } from '@/lib/payouts/server';
import type { Db } from '@/lib/platform/db';

const ID = '00000000-0000-7000-8000-000000000000'; // a well-formed id nothing owns: past the permission check the call just finds nothing

/** Runs `fn` inside a transaction that is always rolled back: a call that would really write can then run for a superadmin in the permission matrix without touching shared state. */
const rolledBack = (db: Db, fn: (tx: Db) => Promise<unknown>) =>
  db.transaction(async (tx) => {
    await fn(tx as unknown as Db);
    tx.rollback();
  });

export type AdminCall = { name: string; permission: AdminPermission | 'any'; mutates: boolean; run: (db: Db, admin: AdminContext) => Promise<unknown> };

/**
 * Every admin function behind the console, with the permission PLAN §9 gives its area. One list feeds the
 * permission matrix test; the audit test (every mutation writes `audit_log`) reads the `mutates` entries.
 * Add each area's functions here when its screen is built.
 */
export const ADMIN_CALLS: readonly AdminCall[] = [
  { name: 'clearance.list', permission: 'clearance', mutates: false, run: (db, a) => listClearanceQueue(db, a) },
  { name: 'clearance.escalate', permission: 'clearance', mutates: true, run: (db, a) => escalateClearance(db, a, ID) },
  { name: 'clearance.resolve', permission: 'clearance', mutates: true, run: (db, a) => resolveClearance(db, a, ID, { outcome: 'released', note: 'evidence note' }) },
  { name: 'clearance.resend', permission: 'clearance', mutates: true, run: (db, a) => resendClearance(db, a, ID) },
  { name: 'disputes.list', permission: 'disputes', mutates: false, run: (db, a) => listDisputes(db, a) },
  { name: 'disputes.detail', permission: 'disputes', mutates: false, run: (db, a) => getDisputeDetail(db, a, ID) },
  { name: 'disputes.first_action', permission: 'disputes', mutates: true, run: (db, a) => recordFirstAction(db, a, ID, { note: 'called the seller' }) },
  { name: 'disputes.resolve', permission: 'disputes', mutates: true, run: (db, a) => resolveDispute(db, a, ID, { resolution: 'released', note: 'released' }) },
  { name: 'disputes.claimant_cataloged', permission: 'disputes', mutates: true, run: (db, a) => setClaimantCataloged(db, a, ID, true) },
  { name: 'disputes.request_refund', permission: 'finance', mutates: true, run: (db, a) => requestDisputeRefund(db, a, ID) },
  { name: 'complaints.list', permission: 'disputes', mutates: false, run: (db, a) => listComplaints(db, a) },
  { name: 'complaints.investigate', permission: 'disputes', mutates: true, run: (db, a) => startInvestigation(db, a, ID) },
  { name: 'complaints.resolve', permission: 'disputes', mutates: true, run: (db, a) => resolveComplaint(db, a, ID, { outcome: 'rejected', note: 'spam' }) },
  { name: 'refunds.list', permission: 'finance', mutates: false, run: (db, a) => listRefunds(db, a) },
  { name: 'refunds.eligible_disputes', permission: 'finance', mutates: false, run: (db, a) => listRefundEligibleDisputes(db, a) },
  { name: 'refunds.retry', permission: 'finance', mutates: true, run: (db, a) => retryRefund(db, a, ID) },
  { name: 'refunds.credit_note', permission: 'finance', mutates: true, run: (db, a) => refundCreditNoteUrl(db, a, ID) },
  { name: 'payouts.list', permission: 'finance', mutates: false, run: (db, a) => listPayoutBatches(db, a) },
  { name: 'payouts.detail', permission: 'finance', mutates: false, run: (db, a) => getPayoutBatchDetail(db, a, ID) },
  // A period that has not ended: past the permission check the compute refuses, so the shared test database gains no batch.
  { name: 'payouts.compute', permission: 'finance', mutates: true, run: (db, a) => computePayoutBatch(db, a, '2999-12') },
  { name: 'payouts.approve', permission: 'finance', mutates: true, run: (db, a) => approvePayoutBatch(db, a, ID) },
  { name: 'payouts.submit', permission: 'finance', mutates: true, run: (db, a) => submitPayoutBatch(db, a, ID, { id: 'bank_file', submit: async () => ({ railRef: 'x' }) }) },
  { name: 'payouts.bank_file', permission: 'finance', mutates: true, run: (db, a) => payoutBankFileUrl(db, a, ID) },
  { name: 'payouts.statement', permission: 'finance', mutates: true, run: (db, a) => payoutStatementUrl(db, a, ID) },
  { name: 'payouts.record_paid', permission: 'finance', mutates: true, run: (db, a) => recordPayoutPaid(db, a, ID, 'UTR123456') },
  { name: 'payouts.record_failed', permission: 'finance', mutates: true, run: (db, a) => recordPayoutFailed(db, a, ID, 'bank rejected') },
  { name: 'reconciliation.list', permission: 'finance', mutates: false, run: (db, a) => listReconciliationItems(db, a) },
  { name: 'reconciliation.resolve', permission: 'finance', mutates: true, run: (db, a) => resolveReconciliationItem(db, a, ID, 'refunded the buyer') },
  { name: 'enquiries.list', permission: 'any', mutates: false, run: (db, a) => listEnquiries(db, a) },
  { name: 'enquiries.set_status', permission: 'any', mutates: true, run: (db, a) => setEnquiryStatus(db, a, ID, 'contacted') },
  { name: 'refunds.request', permission: 'finance', mutates: true, run: (db, a) => requestRefund(db, a, ID, { reason: 'admin_goodwill' }) },
  { name: 'payouts.verify_account', permission: 'finance', mutates: true, run: (db, a) => verifyPayoutAccount(db, a, ID, true) },
  { name: 'catalog.list', permission: 'verification', mutates: false, run: (db, a) => listAdminTracks(db, a) },
  { name: 'catalog.approve', permission: 'verification', mutates: true, run: (db, a) => approveTrack(db, a, { trackId: ID, clearanceClass: 'A', priceLevel: 'L1' }) },
  { name: 'catalog.reject', permission: 'verification', mutates: true, run: (db, a) => rejectTrack(db, a, { trackId: ID, reason: 'not suitable' }) },
  { name: 'catalog.availability', permission: 'verification', mutates: true, run: (db, a) => setTrackAvailability(db, a, { trackId: ID, action: 'suspend', reason: 'complaint' }) },
  { name: 'catalog.reclassify', permission: 'verification', mutates: true, run: (db, a) => reclassifyTrack(db, a, { trackId: ID, to: 'C', reason: 'claim found' }) },
  { name: 'catalog.rights_document', permission: 'verification', mutates: true, run: (db, a) => rightsDocumentDownloadUrl(db, a, ID) },
  { name: 'catalog.probe', permission: 'verification', mutates: true, run: (db, a) => recordClaimProbe(db, a, { versionId: ID, platform: 'youtube', claims: [] }) },
  { name: 'taxonomy.list', permission: 'verification', mutates: false, run: (db, a) => listTaxonomyAdmin(db, a) },
  { name: 'taxonomy.create', permission: 'verification', mutates: true, run: (db, a) => rolledBack(db, (tx) => createTaxonomyItem(tx, a, { kind: 'genre', name: 'Matrix probe genre' })) },
  { name: 'taxonomy.set_active', permission: 'verification', mutates: true, run: (db, a) => setTaxonomyActive(db, a, { kind: 'genre', id: ID, active: false }) },
  { name: 'pricing.list', permission: 'verification', mutates: false, run: (db, a) => listPriceBooks(db, a) },
  // An empty grid: past the permission check the schema refuses it, so no draft book is written.
  { name: 'pricing.create', permission: 'verification', mutates: true, run: (db, a) => createPriceBook(db, a, []) },
  { name: 'pricing.activate', permission: 'verification', mutates: true, run: (db, a) => activatePriceBook(db, a, ID) },
  { name: 'kyc.set_status', permission: 'verification', mutates: true, run: (db, a) => setKycStatus(db, a, ID, 'pending', 'documents re-requested') },
  { name: 'kyc.document', permission: 'verification', mutates: true, run: (db, a) => sellerDocumentDownloadUrl(db, a, ID) },
  { name: 'channels.confirm', permission: 'clearance', mutates: true, run: (db, a) => adminConfirmChannel(db, a, ID) },
  { name: 'licenses.revoke', permission: 'disputes', mutates: true, run: (db, a) => adminRevokeLicense(db, a, ID, { reason: 'fraud', note: 'chargeback ring' }) },
  { name: 'legal.list', permission: 'superadmin', mutates: false, run: (db, a) => listLegalDocuments(db, a) },
  { name: 'legal.publish', permission: 'superadmin', mutates: true, run: (db, a) => rolledBack(db, (tx) => publishLegalDocument(tx, a, { kind: 'tos', bodyMarkdown: 'Matrix probe terms of service text.' })) },
  { name: 'terms.publish', permission: 'superadmin', mutates: true, run: (db, a) => publishTermsVersion(db, a, { tier: 'creator', termKind: 'perpetual', termMonths: null, videoCap: null, maxChannels: 1, allowedPlatforms: ['youtube'], organicOnly: true, licenseTextDocumentId: ID }) },
  { name: 'audit.list', permission: 'superadmin', mutates: false, run: (db, a) => listAuditLog(db, a) },
];

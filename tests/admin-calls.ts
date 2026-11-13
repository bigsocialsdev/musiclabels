import { escalateClearance, listClearanceQueue, resendClearance, resolveClearance } from '@/lib/clearance/server';
import { getDisputeDetail, listComplaints, listDisputes, recordFirstAction, requestDisputeRefund, resolveComplaint, resolveDispute, setClaimantCataloged, startInvestigation } from '@/lib/disputes/server';
import type { AdminContext, AdminPermission } from '@/lib/identity/server';
import type { Db } from '@/lib/platform/db';

const ID = '00000000-0000-7000-8000-000000000000'; // a well-formed id nothing owns: past the permission check the call just finds nothing

export type AdminCall = { name: string; permission: AdminPermission; mutates: boolean; run: (db: Db, admin: AdminContext) => Promise<unknown> };

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
];

import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { orders } from '@/db/schema';
import { ensureFirstCertificate, verifyUrl } from '@/lib/certificates/server';
import { getInvoiceByOrder, issueInvoice, storeInvoicePdf } from '@/lib/invoicing/server';
import { creditSaleRoyalty } from '@/lib/ledger/server';
import { TIER_LABELS } from '@/lib/certificates';
import { getLicenseByOrder, issueLicense, sellabilityIssues, type Tier } from '@/lib/licensing/server';
import { enqueueEmail, enqueueOpsAlert } from '@/lib/notifications/server';
import { createRefundRequest } from '@/lib/payments/server';
import type { DbOrTx } from '@/lib/platform/db';
import { errorMessage } from '@/lib/platform/log';
import type { ObjectStore } from '@/lib/platform/storage';
import type { OrderSnapshot } from '../index';
import { applyOrderTransition } from './transition';

const STALE_CLAIM_MINUTES = 10;
/** Unclaimed, or claimed by a run that has evidently died. */
const claimable = () => or(isNull(orders.fulfilClaimedAt), lt(orders.fulfilClaimedAt, sql`now() - make_interval(mins => ${STALE_CLAIM_MINUTES})`));

export type FulfilResult = 'fulfilled' | 'refund_pending' | 'skipped';

/**
 * The `fulfil` handler for one paid order (PLAN §5.2 step 5), run by after() and by the sweep. The claim is a
 * compare-and-set on fulfil_claimed_at, so concurrent runs do the work once; every step is idempotent, so a
 * run that died part-way is finished by the next one:
 *  a. sellability re-check (skipped once the license exists);
 *  b. legal-facts transaction: invoice number + invoice, license, royalty credit, buyer email;
 *  c. invoice and certificate PDFs;
 *  d. paid → fulfilled.
 * Errors are recorded on the order and rethrown; the order stays paid for the next run.
 */
export async function fulfilOrder(db: DbOrTx, orderId: string, store: ObjectStore): Promise<FulfilResult> {
  const [o] = await db
    .update(orders)
    .set({ fulfilClaimedAt: new Date(), fulfilAttempts: sql`${orders.fulfilAttempts} + 1` })
    .where(
      and(
        eq(orders.id, orderId),
        eq(orders.status, 'paid'),
        claimable(),
      ),
    )
    .returning();
  if (!o) return 'skipped';

  try {
    const snap = o.snapshot as OrderSnapshot;
    let license = await getLicenseByOrder(db, o.id);

    if (!license) {
      const issues = await sellabilityIssues(db, o.trackId);
      if (issues.length) {
        await db.transaction(async (tx) => {
          const t = await applyOrderTransition(tx, o.id, 'unsellable', { actorUserId: null, reason: `unsellable_at_fulfilment: ${issues.join(', ')}`, set: { fulfilClaimedAt: null } });
          if (t.ok) {
            // The full refund is queued with the transition; the sweep sends it (PLAN §5.2 a).
            await createRefundRequest(tx, { orderId: o.id, reason: 'unsellable_at_fulfilment', amountPaise: o.totalPaise, requestedBy: null });
            await enqueueOpsAlert(tx, 'unsellable_at_fulfilment', 'Paid order could not be fulfilled; a full refund is queued', { orderId: o.id, issues });
          }
        });
        return 'refund_pending';
      }

      license = await db.transaction(async (tx) => {
        const [locked] = await tx.select({ status: orders.status }).from(orders).where(eq(orders.id, o.id)).for('update');
        if (locked?.status !== 'paid') throw new Error(`order ${o.id} is ${locked?.status}, not paid`);
        const { invoice } = await issueInvoice(tx, {
          orderId: o.id,
          issuedAt: new Date(),
          supplierName: snap.supplierName,
          supplierAddress: snap.supplierAddress,
          supplierGstin: snap.supplierGstin,
          supplierStateCode: snap.supplierStateCode,
          sacCode: snap.sacCode,
          recipientName: snap.recipientName,
          recipientGstin: snap.recipientGstin,
          recipientStateCode: snap.recipientStateCode,
          recipientAddress: snap.recipientAddress,
          lineDescription: `${snap.trackTitle} (${snap.primaryArtist}): ${TIER_LABELS[o.tier as Tier]} license${snap.clientName ? `, client ${snap.clientName}` : ''}`,
          gst: {
            taxablePaise: o.taxablePaise,
            cgstPaise: o.cgstPaise,
            sgstPaise: o.sgstPaise,
            igstPaise: o.igstPaise,
            totalPaise: o.totalPaise,
            gstRateBps: o.gstRateBps,
            placeOfSupplyState: snap.placeOfSupplyState,
            intraState: o.igstPaise === 0,
          },
        });
        const issued = await issueLicense(tx, {
          orderId: o.id,
          trackId: o.trackId,
          trackVersionId: o.trackVersionId,
          trackTitle: snap.trackTitle,
          primaryArtist: snap.primaryArtist,
          tier: o.tier as Tier,
          termsVersionId: o.termsVersionId,
          licenseeName: snap.licenseeName,
          clientName: snap.clientName,
          purchaserOrgId: o.buyerOrgId,
          editsAllowed: snap.editsAllowed,
          startsAt: o.paidAt!,
          invoiceNumber: invoice.number,
          channels: snap.channels,
        });
        await creditSaleRoyalty(tx, { orderId: o.id, sellerOrgId: o.sellerOrgId, taxablePaise: o.taxablePaise, royaltyRateBps: o.royaltyRateBps, paidAt: o.paidAt! });
        if (issued.created && snap.buyerEmail) {
          await enqueueEmail(tx, {
            kind: 'license.issued',
            to: snap.buyerEmail,
            template: 'license_issued',
            payload: { trackTitle: snap.trackTitle, publicId: issued.license.publicId, invoiceNumber: invoice.number, verifyUrl: verifyUrl(issued.license.publicId) },
          });
        }
        return issued.license;
      });
    }

    const invoice = await getInvoiceByOrder(db, o.id);
    await storeInvoicePdf(db, invoice!.id, store);
    await ensureFirstCertificate(db, license, store);

    const done = await applyOrderTransition(db, o.id, 'fulfil', { actorUserId: null, set: { fulfilledAt: new Date(), fulfilClaimedAt: null, lastError: null } });
    return done.ok || done.status === 'fulfilled' ? 'fulfilled' : 'skipped';
  } catch (e) {
    await db.update(orders).set({ lastError: errorMessage(e).slice(0, 500), fulfilClaimedAt: null }).where(and(eq(orders.id, o.id), eq(orders.status, 'paid')));
    throw e;
  }
}

/** Sweep input: paid orders not claimed recently, oldest first. */
export async function listPaidOrders(db: DbOrTx, limit = 50): Promise<string[]> {
  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.status, 'paid'), claimable()))
    .orderBy(asc(orders.paidAt))
    .limit(limit);
  return rows.map((r) => r.id);
}

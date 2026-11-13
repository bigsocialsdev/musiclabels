import { eq } from 'drizzle-orm';
import { orders } from '@/db/schema';
import { requirePermission, type AdminContext } from '@/lib/identity';
import { getInvoiceByOrder, issueCreditNote, storeCreditNotePdf } from '@/lib/invoicing/server';
import { reverseSaleRoyalty } from '@/lib/ledger/server';
import { getLicenseByOrder, revokeLicense } from '@/lib/licensing/server';
import { enqueueEmail, enqueueOpsAlert } from '@/lib/notifications/server';
import type { PaymentGateway } from '@/lib/payments';
import {
  claimRefund,
  createRefundRequest,
  getRefund,
  markRefundFailed,
  markRefundProcessed,
  releaseRefund,
  setGatewayRefundId,
  type RefundReason,
} from '@/lib/payments/server';
import type { DbOrTx } from '@/lib/platform/db';
import { errorMessage } from '@/lib/platform/log';
import type { ObjectStore } from '@/lib/platform/storage';
import type { OrderSnapshot } from '../index';
import { applyOrderTransition } from './transition';

export type RequestRefundResult = { ok: true; refundId: string } | { ok: false; reason: 'not_found' | 'not_refundable'; status?: string };

/**
 * Finance approves a full refund (PLAN §5.4). A fulfilled order moves to refund_pending; an order already
 * refund_pending (unsellable at fulfilment) just gets its refund row. One refund per order, for the order
 * total, so a refund can never exceed what was paid. The caller kicks executeRefund after commit.
 */
export async function requestRefund(db: DbOrTx, admin: AdminContext, orderId: string, input: { reason: RefundReason; note?: string | null }): Promise<RequestRefundResult> {
  requirePermission(admin, 'finance');
  return db.transaction(async (tx) => {
    const [o] = await tx.select({ status: orders.status, totalPaise: orders.totalPaise }).from(orders).where(eq(orders.id, orderId)).for('update');
    if (!o) return { ok: false, reason: 'not_found' } as const;
    if (o.status === 'fulfilled') {
      await applyOrderTransition(tx, orderId, 'refund', { actorUserId: admin.userId, reason: input.reason, adminAction: true });
    } else if (o.status !== 'refund_pending') {
      return { ok: false, reason: 'not_refundable', status: o.status } as const;
    }
    const refund = await createRefundRequest(tx, { orderId, reason: input.reason, amountPaise: o.totalPaise, requestedBy: admin.userId, note: input.note });
    return { ok: true, refundId: refund.id } as const;
  });
}

export type RefundRun = 'processed' | 'pending' | 'failed' | 'skipped';

/**
 * Sends the refund to Razorpay once. The claim is a compare-and-set; before calling, Razorpay is asked for a
 * refund carrying this row's id as receipt, so a run that died after Razorpay accepted the call never refunds
 * twice. Processed now → completeRefund; pending → the webhook or the sweep completes it later.
 */
export async function executeRefund(db: DbOrTx, refundId: string, deps: { gateway: PaymentGateway; store: ObjectStore }): Promise<RefundRun> {
  const refund = await claimRefund(db, refundId);
  if (!refund) return 'skipped';
  try {
    const [o] = await db.select({ paymentId: orders.gatewayPaymentId }).from(orders).where(eq(orders.id, refund.orderId));
    if (!o?.paymentId) throw new Error('order has no captured payment');
    const sent = (await deps.gateway.findRefund(o.paymentId, refund.id)) ?? (await deps.gateway.refund({ paymentId: o.paymentId, amountPaise: refund.amountPaise, receipt: refund.id }));
    if (sent.amountPaise !== refund.amountPaise) throw new Error(`gateway refund amount ${sent.amountPaise} differs from ${refund.amountPaise}`);
    await setGatewayRefundId(db, refund.id, sent.id);
    if (sent.status === 'processed') return (await completeRefund(db, refund.id, deps.store)) ? 'processed' : 'skipped';
    if (sent.status === 'failed') {
      await failRefund(db, refund.id, 'gateway reported the refund failed');
      return 'failed';
    }
    await releaseRefund(db, refund.id, null);
    return 'pending';
  } catch (e) {
    await releaseRefund(db, refund.id, errorMessage(e).slice(0, 500));
    throw e;
  }
}

/**
 * Money is back with the buyer: the refund, order, credit note, license revocation and royalty reversal commit
 * together (CLAUDE.md). An order refunded before fulfilment has no invoice, license or royalty, so only the
 * refund and the order move. Idempotent: a second call (webhook after the API said processed) does nothing.
 */
export async function completeRefund(db: DbOrTx, refundId: string, store?: ObjectStore): Promise<boolean> {
  const done = await db.transaction(async (tx) => {
    if (!(await markRefundProcessed(tx, refundId))) return null;
    const refund = (await getRefund(tx, refundId))!;
    await applyOrderTransition(tx, refund.orderId, 'refund_processed', { actorUserId: null, reason: refund.reason });

    const invoice = await getInvoiceByOrder(tx, refund.orderId);
    const note = invoice ? (await issueCreditNote(tx, { invoiceId: invoice.id, refundId, reason: refund.reason, issuedAt: new Date() })).creditNote : null;
    const license = await getLicenseByOrder(tx, refund.orderId);
    if (license) await revokeLicense(tx, license.id, { reason: 'refund', note: refund.reason });
    await reverseSaleRoyalty(tx, { orderId: refund.orderId, kind: 'refund_reversal' });

    const [o] = await tx.select({ snapshot: orders.snapshot, totalPaise: orders.totalPaise }).from(orders).where(eq(orders.id, refund.orderId));
    const snap = o!.snapshot as OrderSnapshot;
    if (snap.buyerEmail) {
      await enqueueEmail(tx, {
        kind: 'refund.processed',
        to: snap.buyerEmail,
        template: 'refund_processed',
        payload: { trackTitle: snap.trackTitle, amountPaise: o!.totalPaise, creditNoteNumber: note?.number ?? null },
      });
    }
    return { creditNoteId: note?.id ?? null };
  });
  if (!done) return false;
  if (done.creditNoteId && store) await storeCreditNotePdf(db, done.creditNoteId, store); // re-renderable; the sweep fills any gap
  return true;
}

export async function failRefund(db: DbOrTx, refundId: string, error: string): Promise<void> {
  await db.transaction(async (tx) => {
    if (await markRefundFailed(tx, refundId, error)) {
      await enqueueOpsAlert(tx, 'refund_failed', 'Refund failed at Razorpay: retry or settle by hand', { refundId, error });
    }
  });
}

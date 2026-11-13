import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { formatInr } from '@/lib/invoicing';
import { expireIfUnpaid, fulfilOrder, getOrderForBuyer, productionDeps } from '@/lib/orders/server';
import { getDb } from '@/lib/platform/db';
import { errorMessage, log } from '@/lib/platform/log';
import { kick } from '@/lib/platform/tasks';
import { requireBuyerSession } from '../../buyer-session';

export const dynamic = 'force-dynamic';

const STATUS_TEXT: Record<string, string> = {
  created: 'Payment not started.',
  awaiting_payment: 'Waiting for payment confirmation from Razorpay…',
  paid: 'Payment received. Issuing your license, certificate and invoice…',
  failed: 'The payment failed. You were not charged.',
  expired: 'This checkout expired without a payment.',
  refund_pending: 'This order could not be fulfilled and will be refunded in full.',
  refunded: 'This order was refunded.',
};

/** Checkout return page. Lapsed unpaid orders are checked against Razorpay before showing them as expired. */
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireBuyerSession(`/orders/${id}`);
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  let order = await getOrderForBuyer(db, session.userId, id);
  if (!order) notFound();
  if (order.status === 'awaiting_payment' && order.expiresAt < new Date()) {
    const deps = productionDeps();
    const r = await expireIfUnpaid(db, id, deps.gateway).catch((e: unknown) => {
      log.error('lazy expiry check failed', { orderId: id, error: errorMessage(e) });
      return null;
    });
    if (r?.fulfilOrderId) {
      const paidId = r.fulfilOrderId;
      kick('fulfil', () => fulfilOrder(getDb(), paidId, deps.store));
    }
    order = (await getOrderForBuyer(db, session.userId, id))!;
  }
  if (order.licenseId && order.status === 'fulfilled') redirect(`/licenses/${order.licenseId}`);
  const s = order.snapshot;
  return (
    <main className="mx-auto max-w-xl p-8">
      {(order.status === 'paid' || order.status === 'awaiting_payment') && <meta httpEquiv="refresh" content="3" />}
      <h1 className="text-xl font-semibold">{s.trackTitle}</h1>
      <p role="status" className="mt-2">
        {STATUS_TEXT[order.status] ?? order.status}
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-1 text-sm">
        <dt>Taxable value</dt>
        <dd>{formatInr(order.taxablePaise)}</dd>
        {order.igstPaise > 0 ? (
          <>
            <dt>IGST</dt>
            <dd>{formatInr(order.igstPaise)}</dd>
          </>
        ) : (
          <>
            <dt>CGST + SGST</dt>
            <dd>
              {formatInr(order.cgstPaise)} + {formatInr(order.sgstPaise)}
            </dd>
          </>
        )}
        <dt className="font-semibold">Total</dt>
        <dd className="font-semibold">{formatInr(order.totalPaise)}</dd>
      </dl>
      <p className="mt-6 text-sm">
        <Link className="underline" href="/">
          Back to the catalog
        </Link>
      </p>
    </main>
  );
}

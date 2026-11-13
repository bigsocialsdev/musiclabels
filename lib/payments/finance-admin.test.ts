import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLog, payoutBatches, reconciliationItems } from '@/db/schema';
import { executeRefund, requestRefund } from '@/lib/orders/server';
import { approvePayoutBatch, getPayoutBatchDetail, payoutBankFileUrl, payoutStatementUrl } from '@/lib/payouts/server';
import { closeDb, getDb } from '@/lib/platform/db';
import { adminCtx, sale, setupCommerce } from '@/tests/commerce';
import { FakeGateway, MemoryStore } from '@/tests/fakes';
import { listReconciliationItems, listRefunds, refundCreditNoteUrl, resolveReconciliationItem, retryRefund } from './server';

afterAll(closeDb);
const db = getDb();
const gw = new FakeGateway();
const store = new MemoryStore();
beforeAll(() => setupCommerce(db, { L1: 100_000, L2: 200_000, L3: 300_000, L4: 400_000, L5: 5_000_000 }));

const item = async (kind: 'unknown_payment' | 'amount_mismatch') => {
  const ref = `pay_${crypto.randomUUID()}`;
  const [row] = await db.insert(reconciliationItems).values({ kind, gatewayRef: ref, details: { amountPaise: 1 } }).returning();
  return row!;
};

describe('reconciliation admin (PLAN §5.7, §9)', () => {
  it('lists open items first and needs the finance permission', async () => {
    const finance = await adminCtx(db, ['finance']);
    const open = await item('unknown_payment');
    const closed = await item('amount_mismatch');
    await resolveReconciliationItem(db, finance, closed.id, 'refunded');
    const rows = await listReconciliationItems(db, finance);
    const at = (id: string) => rows.findIndex((r) => r.id === id);
    expect(at(open.id)).toBeGreaterThanOrEqual(0);
    expect(rows.slice(0, rows.filter((r) => r.status === 'open').length).every((r) => r.status === 'open')).toBe(true);
    expect((await listReconciliationItems(db, finance, 'resolved')).every((r) => r.status === 'resolved')).toBe(true);
    await expect(listReconciliationItems(db, await adminCtx(db, ['disputes']))).rejects.toThrow();
  });

  it('resolves an item once, with a note, and audits it', async () => {
    const finance = await adminCtx(db, ['finance']);
    const row = await item('unknown_payment');
    await expect(resolveReconciliationItem(db, finance, row.id, '   ')).rejects.toThrow(/note/i);
    await expect(resolveReconciliationItem(db, await adminCtx(db, ['clearance']), row.id, 'done')).rejects.toThrow();
    expect(await resolveReconciliationItem(db, finance, row.id, ' refunded in the dashboard ', '203.0.113.9')).toEqual({ ok: true });
    expect(await resolveReconciliationItem(db, finance, row.id, 'again')).toEqual({ ok: false });
    const [after] = await db.select().from(reconciliationItems).where(eq(reconciliationItems.id, row.id));
    expect(after).toMatchObject({ status: 'resolved', resolvedBy: finance.userId, resolutionNote: 'refunded in the dashboard' });
    const audits = await db.select().from(auditLog).where(eq(auditLog.entityId, row.id));
    expect(audits).toMatchObject([{ action: 'reconciliation.resolve', actorUserId: finance.userId, entityType: 'reconciliation_item' }]);
  });
});

describe('finance reads', () => {
  it('lists refunds for finance only', async () => {
    expect(Array.isArray(await listRefunds(db, await adminCtx(db, ['finance'])))).toBe(true);
    await expect(listRefunds(db, await adminCtx(db, ['verification']))).rejects.toThrow();
  });

  it('has no bank file to hand out before a batch is submitted, and returns null for a missing batch', async () => {
    const finance = await adminCtx(db, ['finance']);
    const [batch] = await db.insert(payoutBatches).values({ period: '1961-04', cutoffAt: new Date('1961-05-01T00:00:00Z'), status: 'computed' }).returning();
    expect(await getPayoutBatchDetail(db, finance, batch!.id)).toMatchObject({ batch: { period: '1961-04' }, lines: [] });
    expect(await payoutBankFileUrl(db, finance, batch!.id)).toBeNull();
    expect(await getPayoutBatchDetail(db, finance, '00000000-0000-7000-8000-000000000000')).toBeNull();
    expect(await db.select().from(auditLog).where(eq(auditLog.entityId, batch!.id))).toEqual([]);
  });
});

describe('payout audit rows carry the caller IP', () => {
  it('approving a batch records the address with the admin', async () => {
    const finance = await adminCtx(db, ['finance']);
    const [batch] = await db.insert(payoutBatches).values({ period: '1961-07', cutoffAt: new Date('1961-08-01T00:00:00Z'), status: 'computed' }).returning();
    expect(await approvePayoutBatch(db, finance, batch!.id, '203.0.113.5')).toBe(true);
    expect(await db.select().from(auditLog).where(eq(auditLog.entityId, batch!.id))).toMatchObject([{ action: 'payout_batch.approve', actorUserId: finance.userId, ip: '203.0.113.5' }]);
  });

  it('hands out no credit note or statement that does not exist, and audits nothing for it', async () => {
    const finance = await adminCtx(db, ['finance']);
    const none = '00000000-0000-7000-8000-000000000000';
    expect(await refundCreditNoteUrl(db, finance, none)).toBeNull();
    expect(await payoutStatementUrl(db, finance, none)).toBeNull();
    expect(await db.select().from(auditLog).where(eq(auditLog.entityId, none))).toEqual([]);
  });
});

describe('refund approval and retry are audited with the admin (PLAN §9)', () => {
  const audits = (refundId: string, action: string) => db.select().from(auditLog).where(and(eq(auditLog.entityId, refundId), eq(auditLog.action, action)));

  it('approving writes one refund.requested row naming the admin, and approving again adds none', async () => {
    const finance = await adminCtx(db, ['finance']);
    const s = await sale(db, gw, store);
    const first = await requestRefund(db, finance, s.orderId, { reason: 'admin_goodwill' });
    if (!first.ok) throw new Error(first.reason);
    expect(await audits(first.refundId, 'refund.requested')).toMatchObject([{ actorUserId: finance.userId, entityType: 'refund' }]);
    const again = await requestRefund(db, finance, s.orderId, { reason: 'admin_goodwill' });
    expect(again).toMatchObject({ ok: true, refundId: first.refundId }); // refund_pending: returns the existing row
    expect(await audits(first.refundId, 'refund.requested')).toHaveLength(1);
  });

  it('"send again" audits the admin, only for a refund that can still be sent, and needs finance', async () => {
    const finance = await adminCtx(db, ['finance']);
    const s = await sale(db, gw, store);
    const r = await requestRefund(db, finance, s.orderId, { reason: 'admin_goodwill' });
    if (!r.ok) throw new Error(r.reason);
    await expect(retryRefund(db, await adminCtx(db, ['disputes']), r.refundId)).rejects.toThrow();
    expect(await retryRefund(db, finance, r.refundId, '203.0.113.7')).toEqual({ ok: true });
    expect(await audits(r.refundId, 'refund.retry')).toMatchObject([{ actorUserId: finance.userId, before: { status: 'requested' } }]);
    expect(await executeRefund(db, r.refundId, { gateway: gw, store })).toBe('processed');
    expect(await retryRefund(db, finance, r.refundId)).toEqual({ ok: false });
    expect(await retryRefund(db, finance, '00000000-0000-7000-8000-000000000000')).toEqual({ ok: false });
    expect(await audits(r.refundId, 'refund.retry')).toHaveLength(1);
  });
});

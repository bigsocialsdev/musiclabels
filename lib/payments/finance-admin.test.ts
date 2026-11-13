import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLog, payoutBatches, reconciliationItems } from '@/db/schema';
import { getPayoutBatchDetail, payoutBankFileUrl } from '@/lib/payouts/server';
import { closeDb, getDb } from '@/lib/platform/db';
import { adminCtx } from '@/tests/commerce';
import { listReconciliationItems, listRefunds, resolveReconciliationItem } from './server';

afterAll(closeDb);
const db = getDb();

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

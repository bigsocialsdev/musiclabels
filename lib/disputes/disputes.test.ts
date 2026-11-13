import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { auditLog, copyrightComplaints, disputeEvents, disputes, licenses, orders, outbox, tracks } from '@/db/schema';
import { closeDb, getDb } from '@/lib/platform/db';
import { adminCtx, sale, setupCommerce } from '@/tests/commerce';
import { makeSellableTrack } from '@/tests/factories';
import { FakeGateway, MemoryStore } from '@/tests/fakes';
import { adminRevokeLicense } from '@/lib/licensing/server';
import { executeRefund, requestRefund } from '@/lib/orders/server';
import {
  DISPUTE_EVENTS,
  DISPUTE_STATUSES,
  DISPUTE_TRANSITIONS,
  getBuyerDisputeEvents,
  getDisputeDetail,
  isDisputeOverdue,
  listBuyerDisputes,
  listComplaints,
  listDisputes,
  makeRefundEligible,
  nextDisputeStatus,
  noticeOverdueDisputes,
  openDispute,
  recordFirstAction,
  requestDisputeRefund,
  resolveComplaint,
  resolveDispute,
  setClaimantCataloged,
  settleRefundedDisputes,
  startInvestigation,
  submitCopyrightComplaint,
  sweepDisputes,
} from './server';

afterAll(closeDb);
const db = getDb();
const gw = new FakeGateway();
const store = new MemoryStore();
const DAY = 86_400_000;

beforeAll(() => setupCommerce(db, { L1: 100_000, L2: 100_000, L3: 100_000, L4: 100_000, L5: 100_000 }));

const dbMessage = async (q: ReturnType<typeof sql>) => {
  const err = await db.execute(q).then(() => null, (e: Error) => e);
  return ((err?.cause as Error | undefined) ?? err)?.message;
};
type Sale = Awaited<ReturnType<typeof sale>>;
const actor = (s: Sale) => ({ userId: s.buyer.owner.userId, orgId: s.buyer.orgId });
const claim = (over: Record<string, unknown> = {}) => ({
  videoUrl: `https://youtube.com/watch?v=${Math.random().toString(36).slice(2)}`,
  platform: 'youtube' as const,
  disputeType: 'content_id_claim' as const,
  claimantName: 'Some Label',
  ...over,
});
async function opened(s: Sale, over: Record<string, unknown> = {}, now?: Date) {
  const r = await openDispute(db, actor(s), s.licenseId!, claim(over), now);
  if (!r.ok) throw new Error(r.issues.join());
  return r.value.disputeId;
}
const row = async (id: string) => (await db.select().from(disputes).where(eq(disputes.id, id)))[0]!;
const mailsTo = (to: string, kind: string) => db.select().from(outbox).where(and(eq(outbox.to, to), eq(outbox.kind, kind)));
const dispatcher = () => adminCtx(db, ['disputes']);

describe('dispute state machine (PLAN 4.6)', () => {
  it('matches the transition table for every status × event pair', () => {
    for (const from of DISPUTE_STATUSES) {
      for (const event of DISPUTE_EVENTS) {
        const expected = DISPUTE_TRANSITIONS.find((t) => t.from === from && t.event === event)?.to ?? null;
        expect(nextDisputeStatus(from, event)).toBe(expected);
      }
    }
    expect(nextDisputeStatus('resolved_kit_issued', 'make_refund_eligible')).toBe('refund_eligible'); // "refund_eligible still applies on its window"
    expect(nextDisputeStatus('resolved_released', 'make_refund_eligible')).toBeNull();
    expect(nextDisputeStatus('open', 'release')).toBeNull(); // a first action comes first
  });

  it('the database enforces the same moves; the reported facts and timers never change; history is append-only', async () => {
    const s = await sale(db, gw, store);
    const id = await opened(s);
    expect(await dbMessage(sql`UPDATE disputes SET status = 'resolved_released' WHERE id = ${id}`)).toMatch(/open -> resolved_released is not allowed/);
    expect(await dbMessage(sql`UPDATE disputes SET first_action_due_at = now() + interval '30 days' WHERE id = ${id}`)).toMatch(/immutable/);
    expect(await dbMessage(sql`UPDATE disputes SET claimant_name = 'Other' WHERE id = ${id}`)).toMatch(/immutable/);
    expect(await dbMessage(sql`UPDATE disputes SET resolution_due_at = null WHERE id = ${id}`)).toMatch(/immutable/);
    expect(await dbMessage(sql`DELETE FROM disputes WHERE id = ${id}`)).toBeTruthy();
    expect(await dbMessage(sql`UPDATE dispute_events SET note = 'x' WHERE dispute_id = ${id}`)).toBeTruthy();
    expect(await dbMessage(sql`DELETE FROM dispute_events WHERE dispute_id = ${id}`)).toBeTruthy();
  });

  it('two admins recording the first action at once: one wins, one event', async () => {
    const s = await sale(db, gw, store);
    const id = await opened(s);
    const a = await dispatcher();
    const b = await dispatcher();
    const results = await Promise.all([recordFirstAction(db, a, id, { note: 'Emailed seller' }), recordFirstAction(db, b, id, { note: 'Called seller' })]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await db.select().from(disputeEvents).where(and(eq(disputeEvents.disputeId, id), eq(disputeEvents.kind, 'first_action')))).toHaveLength(1);
    expect((await row(id)).status).toBe('in_progress');
  });
});

describe('opening a dispute sets its timers (PLAN 4.6, 5.4)', () => {
  it('Class A and B: first action in 1 business day, 48-hour resolution, refund window of 7 days; buyer and seller emailed', async () => {
    const wed = new Date('2030-01-02T10:00:00Z');
    for (const cls of ['A', 'B'] as const) {
      const s = await sale(db, gw, store, { clearanceClass: cls });
      const id = await opened(s, {}, wed);
      const d = await row(id);
      expect(d.clearanceClassAtOpen).toBe(cls);
      expect(d.firstActionDueAt).toEqual(new Date('2030-01-03T10:00:00Z'));
      expect(d.resolutionDueAt).toEqual(new Date('2030-01-04T10:00:00Z'));
      expect(d.refundEligibleAt).toEqual(new Date('2030-01-09T10:00:00Z'));
      expect(d).toMatchObject({ status: 'open', openedBy: s.buyer.owner.userId });
      expect(await mailsTo(s.buyer.owner.email!, 'dispute.opened')).toHaveLength(1);
      expect(await mailsTo('ops@seller.example', 'dispute.opened_seller')).not.toHaveLength(0);
      expect((await db.select().from(disputeEvents).where(eq(disputeEvents.disputeId, id))).map((e) => e.kind)).toEqual(['opened']);
    }
  });

  it('a Friday opening is due the next Monday (business days skip the weekend)', async () => {
    const s = await sale(db, gw, store);
    const d = await row(await opened(s, {}, new Date('2030-01-04T10:00:00Z')));
    expect(d.firstActionDueAt).toEqual(new Date('2030-01-07T10:00:00Z'));
    expect(d.resolutionDueAt).toEqual(new Date('2030-01-06T10:00:00Z')); // 48 hours is wall-clock
  });

  it('on a track since reclassified C there is no resolution due date, but the first action is still due', async () => {
    const s = await sale(db, gw, store, { clearanceClass: 'B' });
    await db.update(tracks).set({ clearanceClass: 'C' }).where(eq(tracks.id, s.trackId));
    const d = await row(await opened(s));
    expect(d).toMatchObject({ clearanceClassAtOpen: 'C', resolutionDueAt: null });
    expect(d.firstActionDueAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('the same claim reported twice is one dispute; a different type or a closed one can be reported again', async () => {
    const s = await sale(db, gw, store);
    const input = claim();
    const first = await openDispute(db, actor(s), s.licenseId!, input);
    expect(first.ok).toBe(true);
    expect(await openDispute(db, actor(s), s.licenseId!, input)).toEqual({ ok: false, issues: ['duplicate_open_dispute'] });
    expect((await openDispute(db, actor(s), s.licenseId!, { ...input, disputeType: 'mute' })).ok).toBe(true);
    if (!first.ok) throw new Error();
    const admin = await dispatcher();
    await recordFirstAction(db, admin, first.value.disputeId, { note: 'seller contacted' });
    await resolveDispute(db, admin, first.value.disputeId, { resolution: 'released', note: 'released by the claimant' });
    expect((await openDispute(db, actor(s), s.licenseId!, input)).ok).toBe(true);
  });

  it('only the purchasing org can open one; a revoked license cannot; bad input is rejected', async () => {
    const s = await sale(db, gw, store);
    const other = await sale(db, gw, store);
    expect(await openDispute(db, actor(other), s.licenseId!, claim())).toEqual({ ok: false, issues: ['not_found'] });
    expect(await openDispute(db, { userId: other.buyer.owner.userId, orgId: s.buyer.orgId }, s.licenseId!, claim())).toEqual({ ok: false, issues: ['not_found'] });
    await expect(openDispute(db, actor(s), s.licenseId!, claim({ videoUrl: 'http://insecure.example/v' }))).rejects.toThrow();
    await expect(openDispute(db, actor(s), s.licenseId!, claim({ platform: 'tiktok' }))).rejects.toThrow();
    await adminRevokeLicense(db, await adminCtx(db, ['disputes']), s.licenseId!, { reason: 'fraud', note: 'test' });
    expect(await openDispute(db, actor(s), s.licenseId!, claim())).toEqual({ ok: false, issues: ['license_revoked'] });
  });

  it('the buyer sees their disputes and a log without internal notes; another org sees nothing', async () => {
    const s = await sale(db, gw, store);
    const other = await sale(db, gw, store);
    const id = await opened(s);
    await recordFirstAction(db, await dispatcher(), id, { note: 'INTERNAL: seller is unresponsive' });
    expect((await listBuyerDisputes(db, actor(s), s.licenseId!)).map((d) => d.id)).toEqual([id]);
    expect(await listBuyerDisputes(db, actor(other), s.licenseId!)).toEqual([]);
    expect(Object.keys((await listBuyerDisputes(db, actor(s), s.licenseId!))[0]!)).not.toContain('claimantCataloged'); // internal flag stays with ops
    const log = await getBuyerDisputeEvents(db, actor(s), id);
    expect(log!.map((e) => e.kind)).toEqual(['opened', 'first_action']);
    expect(JSON.stringify(log)).not.toContain('INTERNAL');
    expect(await getBuyerDisputeEvents(db, actor(other), id)).toBeNull();
  });
});

describe('overdue is derived (PLAN 4.6)', () => {
  it('open past the first-action date, or unresolved past the resolution date', () => {
    const d = { status: 'open', firstActionDueAt: new Date('2030-01-03T10:00:00Z'), resolutionDueAt: new Date('2030-01-04T10:00:00Z') };
    expect(isDisputeOverdue(d, new Date('2030-01-03T09:00:00Z'))).toBe(false);
    expect(isDisputeOverdue(d, new Date('2030-01-03T11:00:00Z'))).toBe(true);
    expect(isDisputeOverdue({ ...d, status: 'in_progress' }, new Date('2030-01-03T11:00:00Z'))).toBe(false); // first action was recorded
    expect(isDisputeOverdue({ ...d, status: 'in_progress' }, new Date('2030-01-04T11:00:00Z'))).toBe(true);
    expect(isDisputeOverdue({ ...d, status: 'in_progress', resolutionDueAt: null }, new Date('2031-01-01T00:00:00Z'))).toBe(false); // Class C: no resolution target
    for (const status of ['resolved_released', 'resolved_denied', 'refund_eligible', 'resolved_refunded', 'resolved_kit_issued']) {
      expect(isDisputeOverdue({ ...d, status }, new Date('2031-01-01T00:00:00Z'))).toBe(false);
    }
  });

  it('the queue filters it; the sweep tells the buyer and ops once', async () => {
    const s = await sale(db, gw, store);
    const late = await opened(s, {}, new Date(Date.now() - 10 * DAY));
    const fresh = await opened(s);
    const admin = await dispatcher();
    const overdue = await listDisputes(db, admin, { overdueOnly: true });
    expect(overdue.map((d) => d.id)).toContain(late);
    expect(overdue.map((d) => d.id)).not.toContain(fresh);
    expect((await listDisputes(db, admin)).find((d) => d.id === late)).toMatchObject({ overdue: true, licensePublicId: expect.stringMatching(/^LIC-/) });
    await expect(listDisputes(db, await adminCtx(db, ['clearance']))).rejects.toThrow(/disputes/);

    await noticeOverdueDisputes(db, 1000);
    await noticeOverdueDisputes(db, 1000);
    expect((await row(late)).overdueNotifiedAt).not.toBeNull();
    expect((await row(fresh)).overdueNotifiedAt).toBeNull();
    expect((await db.select().from(disputeEvents).where(and(eq(disputeEvents.disputeId, late), eq(disputeEvents.kind, 'overdue_notice'))))).toHaveLength(1);
    expect((await mailsTo(s.buyer.owner.email!, 'dispute.overdue')).length).toBeGreaterThanOrEqual(1);
    const detail = await getDisputeDetail(db, admin, late);
    expect(detail!.overdue).toBe(true);
    expect(detail!.events.map((e) => e.kind)).toEqual(['opened', 'overdue_notice']);
  });
});

describe('refund eligibility (PLAN 4.6, 5.4)', () => {
  const old = () => new Date(Date.now() - 10 * DAY); // refund window (7 days) already passed

  it('a Class A claim that is not released within the window becomes refund_eligible, once, with the buyer and finance told', async () => {
    const s = await sale(db, gw, store, { clearanceClass: 'A' });
    const id = await opened(s, {}, old());
    expect(await dbMessage(sql`UPDATE disputes SET status = 'refund_eligible' WHERE id = ${id}`)).toMatch(/not allowed/);
    await makeRefundEligible(db, 1000);
    expect((await row(id)).status).toBe('open'); // no first action yet: PLAN 4.6 moves in_progress disputes only
    await recordFirstAction(db, await dispatcher(), id, { note: 'seller contacted' });
    await makeRefundEligible(db, 1000);
    await makeRefundEligible(db, 1000);
    expect((await row(id)).status).toBe('refund_eligible');
    expect((await db.select().from(disputeEvents).where(and(eq(disputeEvents.disputeId, id), eq(disputeEvents.kind, 'make_refund_eligible'))))).toHaveLength(1);
    expect((await mailsTo(s.buyer.owner.email!, 'dispute.refund_eligible'))).toHaveLength(1);
    expect(await db.select().from(auditLog).where(and(eq(auditLog.entityId, id), eq(auditLog.action, 'dispute.make_refund_eligible')))).toHaveLength(1);
  });

  it('not before the window, and not for a Class B claim unless the claimant is a cataloged rightsholder', async () => {
    const early = await sale(db, gw, store, { clearanceClass: 'A' });
    const earlyId = await opened(early);
    await recordFirstAction(db, await dispatcher(), earlyId, { note: 'x' });
    const b = await sale(db, gw, store, { clearanceClass: 'B' });
    const bId = await opened(b, {}, old());
    await recordFirstAction(db, await dispatcher(), bId, { note: 'x' });
    await makeRefundEligible(db, 1000);
    expect((await row(earlyId)).status).toBe('in_progress');
    expect((await row(bId)).status).toBe('in_progress');

    expect(await setClaimantCataloged(db, await dispatcher(), bId, true)).toEqual({ ok: true });
    expect((await db.select().from(auditLog).where(and(eq(auditLog.entityId, bId), eq(auditLog.action, 'dispute.claimant_cataloged')))).length).toBe(1);
    await makeRefundEligible(db, 1000);
    expect((await row(bId)).status).toBe('refund_eligible');
  });

  it('a kit-issued dispute becomes refund-eligible on its window too; a released one never does', async () => {
    const kit = await sale(db, gw, store, { clearanceClass: 'A' });
    const kitId = await opened(kit, {}, old());
    const released = await sale(db, gw, store, { clearanceClass: 'A' });
    const releasedId = await opened(released, {}, old());
    const admin = await dispatcher();
    for (const id of [kitId, releasedId]) await recordFirstAction(db, admin, id, { note: 'x' });
    await resolveDispute(db, admin, kitId, { resolution: 'kit_issued', note: 'third-party claim' });
    await resolveDispute(db, admin, releasedId, { resolution: 'released', note: 'released' });
    await makeRefundEligible(db, 1000);
    expect((await row(kitId)).status).toBe('refund_eligible');
    expect((await row(releasedId)).status).toBe('resolved_released');
    expect((await row(releasedId)).closedAt).not.toBeNull();
  });

  it('a refund of the order for another reason (goodwill, chargeback) does not settle the dispute', async () => {
    const s = await sale(db, gw, store, { clearanceClass: 'A' });
    const id = await opened(s, {}, old());
    await recordFirstAction(db, await dispatcher(), id, { note: 'x' });
    await makeRefundEligible(db, 1000);
    const goodwill = await requestRefund(db, await adminCtx(db, ['finance']), s.orderId, { reason: 'admin_goodwill' });
    if (!goodwill.ok) throw new Error(goodwill.reason);
    expect(await executeRefund(db, goodwill.refundId, { gateway: gw, store })).toBe('processed');
    await settleRefundedDisputes(db, 1000);
    expect((await row(id)).status).toBe('refund_eligible');
  });

  it('finance approves the refund; once Razorpay refunds the order the sweep settles the dispute', async () => {
    const s = await sale(db, gw, store, { clearanceClass: 'A' });
    const id = await opened(s, {}, old());
    const finance = await adminCtx(db, ['finance']);
    expect(await requestDisputeRefund(db, finance, id)).toMatchObject({ ok: false, reason: 'not_refund_eligible' });
    await recordFirstAction(db, await dispatcher(), id, { note: 'x' });
    await makeRefundEligible(db, 1000);

    await expect(requestDisputeRefund(db, await dispatcher(), id)).rejects.toThrow(/finance/);
    const refund = await requestDisputeRefund(db, finance, id);
    if (!refund.ok) throw new Error(refund.reason);
    expect(await requestDisputeRefund(db, finance, id)).toEqual({ ok: true, refundId: refund.refundId }); // idempotent
    expect((await row(id)).status).toBe('refund_eligible'); // not until the money moves
    expect(await settleRefundedDisputes(db, 1000)).toBe(0);

    expect(await executeRefund(db, refund.refundId, { gateway: gw, store })).toBe('processed');
    const [order] = await db.select().from(orders).where(eq(orders.id, s.orderId));
    expect(order!.status).toBe('refunded');
    expect(await sweepDisputes(db)).toMatchObject({ refunded: expect.any(Number) });
    expect(await row(id)).toMatchObject({ status: 'resolved_refunded' });
    expect((await row(id)).closedAt).not.toBeNull();
    expect((await db.select({ k: disputeEvents.kind }).from(disputeEvents).where(eq(disputeEvents.disputeId, id))).map((e) => e.k)).toEqual(
      expect.arrayContaining(['opened', 'first_action', 'make_refund_eligible', 'refund_processed']),
    );
    expect((await db.select().from(licenses).where(eq(licenses.orderId, s.orderId)))[0]!.status).toBe('revoked');
  });
});

describe('resolving (PLAN 5.4 step 3)', () => {
  it('needs the disputes permission and a note; denied and released are final, kit issued tells the buyer what to do', async () => {
    const s = await sale(db, gw, store);
    const id = await opened(s);
    const admin = await dispatcher();
    await expect(recordFirstAction(db, await adminCtx(db, ['finance']), id, { note: 'x' })).rejects.toThrow(/disputes/);
    await expect(recordFirstAction(db, admin, id, { note: '  ' })).rejects.toThrow(/action/);
    expect(await resolveDispute(db, admin, id, { resolution: 'released', note: 'x' })).toMatchObject({ ok: false, reason: 'invalid' }); // first action comes first
    await recordFirstAction(db, admin, id, { note: 'Contacted the seller and the claimant' });
    await expect(resolveDispute(db, admin, id, { resolution: 'denied', note: '' })).rejects.toThrow(/note/);
    expect(await resolveDispute(db, admin, id, { resolution: 'denied', note: 'The video is a TV ad, outside the creator tier' })).toMatchObject({ ok: true, to: 'resolved_denied' });
    expect(await resolveDispute(db, admin, id, { resolution: 'released', note: 'again' })).toMatchObject({ ok: false, reason: 'invalid' });
    expect((await mailsTo(s.buyer.owner.email!, 'dispute.denied'))).toHaveLength(1);
    expect(await row(id)).toMatchObject({ status: 'resolved_denied', resolution: 'The video is a TV ad, outside the creator tier' });
    const acts = (await db.select({ a: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, id))).map((x) => x.a);
    expect(acts).toEqual(expect.arrayContaining(['dispute.first_action', 'dispute.deny']));
  });
});

describe('third-party copyright complaints (PLAN 5.5)', () => {
  const rndIp = () => `198.51.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const submit = (raw: Parameters<typeof submitCopyrightComplaint>[1], ip: string | null = rndIp()) => submitCopyrightComplaint(db, raw, { ip });
  const input = (over: Record<string, unknown> = {}) => ({ complainantName: 'A. Composer', complainantEmail: `c-${Math.random().toString(36).slice(2)}@example.org`, workClaimed: 'This track copies my song "Moonlight" (2019).', ...over });

  it('intake validates, stores, acknowledges the complainant and alerts the grievance inbox', async () => {
    const t = await makeSellableTrack(db);
    const i = input({ trackId: t.trackId });
    const r = await submit(i);
    if (!r.ok) throw new Error(r.issues.join());
    const [c] = await db.select().from(copyrightComplaints).where(eq(copyrightComplaints.id, r.reference));
    expect(c).toMatchObject({ status: 'received', trackId: t.trackId, complainantEmail: i.complainantEmail });
    expect(c!.acknowledgedAt).not.toBeNull();
    expect(await mailsTo(i.complainantEmail, 'complaint.ack')).toHaveLength(1);
    expect((await db.select().from(outbox).where(eq(outbox.kind, 'alert.copyright_complaint'))).some((m) => JSON.stringify(m.payload).includes(r.reference))).toBe(true);

    expect(await submit(input({ complainantEmail: 'not-an-email' }))).toMatchObject({ ok: false });
    expect(await submit(input({ workClaimed: 'short' }))).toMatchObject({ ok: false });
    expect(await submit(input({ trackId: '00000000-0000-7000-8000-000000000000' }))).toEqual({ ok: false, issues: ['trackId'] });
    expect(await submit(input())).toMatchObject({ ok: true }); // a complaint need not name a track
  });

  it('is throttled per address and per acknowledged email, so the form cannot be used to mail a victim', async () => {
    const ip = rndIp();
    const victim = `victim-${Math.random().toString(36).slice(2)}@example.org`;
    expect((await submit(input({ complainantEmail: victim }), ip)).ok).toBe(true);
    expect((await submit(input({ complainantEmail: victim }), ip)).ok).toBe(true);
    expect(await submit(input({ complainantEmail: victim }), rndIp())).toEqual({ ok: false, issues: ['rate_limited'] }); // third to the same address, from anywhere
    const noisy = rndIp();
    const results = [];
    for (let i = 0; i < 6; i++) results.push((await submit(input(), noisy)).ok);
    expect(results).toEqual([true, true, true, true, true, false]);
  });

  it('the complaint itself is immutable and its status only moves forward', async () => {
    const r = await submit(input());
    if (!r.ok) throw new Error();
    expect(await dbMessage(sql`UPDATE copyright_complaints SET work_claimed = 'edited' WHERE id = ${r.reference}`)).toMatch(/immutable/);
    expect(await dbMessage(sql`UPDATE copyright_complaints SET status = 'upheld' WHERE id = ${r.reference}`)).toMatch(/received -> upheld is not allowed/);
    expect(await dbMessage(sql`DELETE FROM copyright_complaints WHERE id = ${r.reference}`)).toBeTruthy();
  });

  it('upholding suspends the track, alerts ops with its active licenses and leaves those licenses alone', async () => {
    const s = await sale(db, gw, store);
    const r = await submit(input({ trackId: s.trackId }));
    if (!r.ok) throw new Error();
    const officer = await adminCtx(db, ['disputes']);
    const both = await adminCtx(db, ['disputes', 'verification']);
    await expect(listComplaints(db, await adminCtx(db, ['finance']))).rejects.toThrow(/disputes/);
    expect((await listComplaints(db, officer, 'received')).map((c) => c.id)).toContain(r.reference);

    expect(await resolveComplaint(db, officer, r.reference, { outcome: 'upheld', note: 'Confirmed' })).toMatchObject({ ok: false, reason: 'invalid' }); // investigate first
    expect(await startInvestigation(db, officer, r.reference)).toEqual({ ok: true });
    expect(await startInvestigation(db, officer, r.reference)).toEqual({ ok: false });
    expect((await db.select().from(copyrightComplaints).where(eq(copyrightComplaints.id, r.reference)))[0]).toMatchObject({ status: 'investigating', grievanceOfficerId: officer.userId });

    await expect(resolveComplaint(db, officer, r.reference, { outcome: 'upheld', note: 'Confirmed' })).rejects.toThrow(/verification/); // suspending needs it too
    expect((await db.select().from(copyrightComplaints).where(eq(copyrightComplaints.id, r.reference)))[0]!.status).toBe('investigating');
    expect((await db.select().from(tracks).where(eq(tracks.id, s.trackId)))[0]!.status).toBe('published');

    expect(await resolveComplaint(db, both, r.reference, { outcome: 'upheld', note: 'Confirmed by the composer\'s registration' })).toEqual({ ok: true, suspended: true });
    expect((await db.select().from(tracks).where(eq(tracks.id, s.trackId)))[0]!.status).toBe('suspended');
    const [lic] = await db.select().from(licenses).where(eq(licenses.orderId, s.orderId));
    expect(lic!.status).toBe('active'); // existing licenses are never touched
    const alert = (await db.select().from(outbox).where(eq(outbox.kind, 'alert.complaint_upheld'))).find((m) => JSON.stringify(m.payload).includes(lic!.publicId));
    expect(alert).toBeTruthy();
    expect(await db.select().from(auditLog).where(and(eq(auditLog.entityId, r.reference), eq(auditLog.action, 'complaint.upheld')))).toHaveLength(1);
    expect(await db.select().from(auditLog).where(and(eq(auditLog.entityId, s.trackId), eq(auditLog.action, 'track.suspend')))).toHaveLength(1);
    expect(await resolveComplaint(db, both, r.reference, { outcome: 'rejected', note: 'x' })).toMatchObject({ ok: false, reason: 'invalid' }); // closed
  });

  it('a complaint can be rejected from received, and a track-less one can be upheld without a suspension', async () => {
    const spam = await submit(input());
    const noTrack = await submit(input());
    if (!spam.ok || !noTrack.ok) throw new Error();
    const officer = await adminCtx(db, ['disputes']);
    expect(await resolveComplaint(db, officer, spam.reference, { outcome: 'rejected', note: 'Not a copyright matter' })).toEqual({ ok: true, suspended: false });
    await startInvestigation(db, officer, noTrack.reference);
    expect(await resolveComplaint(db, officer, noTrack.reference, { outcome: 'upheld', note: 'No track named; noted' })).toEqual({ ok: true, suspended: false });
    expect((await db.select().from(outbox).where(eq(outbox.kind, 'complaint.outcome'))).length).toBeGreaterThanOrEqual(2);
  });
});

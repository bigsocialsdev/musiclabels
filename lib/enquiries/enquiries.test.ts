import { afterAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { auditLog, enquiries, outbox } from '@/db/schema';
import { closeDb, getDb } from '@/lib/platform/db';
import { adminCtx } from '@/tests/commerce';
import { makeBuyer, makeSellableTrack } from '@/tests/factories';
import { listEnquiries, setEnquiryStatus, submitEnquiry } from './server';

afterAll(closeDb);
const db = getDb();
const rndIp = () => `192.0.2.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const submit = (raw: Parameters<typeof submitEnquiry>[1], extra: { ip?: string | null; orgId?: string | null } = {}) => submitEnquiry(db, raw, { ip: rndIp(), ...extra });

const input = (trackId: string, over: Record<string, unknown> = {}) => ({
  trackId,
  contactName: 'Priya Rao',
  contactEmail: `p-${Math.random().toString(36).slice(2)}@studio.example`,
  intendedUse: 'Title track for a streaming series, 8 episodes, India and worldwide.',
  media: 'ott' as const,
  budgetRange: '5-10 lakh',
  ...over,
});

describe('Commercial/Broadcast enquiries (PLAN 6.1)', () => {
  it('a published track takes an enquiry: stored, acknowledged and alerted, with no license or order', async () => {
    const t = await makeSellableTrack(db);
    const i = input(t.trackId);
    const r = await submit(i);
    if (!r.ok) throw new Error(r.issues.join());
    expect((await db.select().from(enquiries).where(eq(enquiries.id, r.id)))[0]).toMatchObject({ status: 'new', media: 'ott', orgId: null, contactEmail: i.contactEmail, trackId: t.trackId });
    expect(await db.select().from(outbox).where(and(eq(outbox.kind, 'enquiry.ack'), eq(outbox.to, i.contactEmail)))).toHaveLength(1);
    expect((await db.select().from(outbox).where(eq(outbox.kind, 'alert.enquiry'))).some((m) => JSON.stringify(m.payload).includes(r.id))).toBe(true);
  });

  it('rejects bad input, an unpublished track and an unknown track', async () => {
    const draft = await makeSellableTrack(db, { status: 'draft' });
    const classC = await makeSellableTrack(db, { clearanceClass: 'C' }); // published but not on sale
    expect(await submit(input(classC.trackId))).toEqual({ ok: false, issues: ['trackId'] });
    expect(await submit(input(draft.trackId))).toEqual({ ok: false, issues: ['trackId'] });
    expect(await submit(input('00000000-0000-7000-8000-000000000000'))).toEqual({ ok: false, issues: ['trackId'] });
    const t = await makeSellableTrack(db);
    expect(await submit(input(t.trackId, { contactEmail: 'nope' }))).toMatchObject({ ok: false });
    expect(await submit(input(t.trackId, { media: 'radio' }))).toMatchObject({ ok: false });
    expect(await submit(input(t.trackId, { intendedUse: 'short' }))).toMatchObject({ ok: false });
  });

  it('is throttled per address and per acknowledged email', async () => {
    const t = await makeSellableTrack(db);
    const ip = rndIp();
    const email = `v-${Math.random().toString(36).slice(2)}@studio.example`;
    expect((await submit(input(t.trackId, { contactEmail: email }), { ip })).ok).toBe(true);
    expect((await submit(input(t.trackId, { contactEmail: email }), { ip })).ok).toBe(true);
    expect(await submit(input(t.trackId, { contactEmail: email }))).toEqual({ ok: false, issues: ['rate_limited'] });
    const noisy = rndIp();
    const results = [];
    for (let i = 0; i < 6; i++) results.push((await submit(input(t.trackId), { ip: noisy })).ok);
    expect(results).toEqual([true, true, true, true, true, false]);
  });

  it('records the org only when the server action supplies one', async () => {
    const t = await makeSellableTrack(db);
    const b = await makeBuyer(db);
    const r = await submit(input(t.trackId), { orgId: b.orgId });
    if (!r.ok) throw new Error();
    expect((await db.select().from(enquiries).where(eq(enquiries.id, r.id)))[0]!.orgId).toBe(b.orgId);
  });

  it('any admin works the pipeline; a non-admin cannot; moves are forward only and audited', async () => {
    const t = await makeSellableTrack(db);
    const r = await submit(input(t.trackId));
    if (!r.ok) throw new Error();
    const admin = await adminCtx(db, ['clearance']);
    await expect(listEnquiries(db, { userId: admin.userId, permissions: [] })).rejects.toThrow(/Admins only/);
    await expect(setEnquiryStatus(db, { userId: admin.userId, permissions: [] }, r.id, 'contacted')).rejects.toThrow(/Admins only/);
    expect((await listEnquiries(db, admin, 'new')).map((e) => e.id)).toContain(r.id);

    expect(await setEnquiryStatus(db, admin, r.id, 'closed_won')).toMatchObject({ ok: false, reason: 'invalid' }); // contact first
    expect(await setEnquiryStatus(db, admin, r.id, 'contacted')).toEqual({ ok: true });
    expect(await setEnquiryStatus(db, admin, r.id, 'new')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await setEnquiryStatus(db, admin, r.id, 'closed_won')).toEqual({ ok: true });
    expect(await setEnquiryStatus(db, admin, r.id, 'closed_lost')).toMatchObject({ ok: false, status: 'closed_won' });
    expect(await setEnquiryStatus(db, admin, '00000000-0000-7000-8000-000000000000', 'contacted')).toEqual({ ok: false, reason: 'not_found' });
    expect(await db.select().from(auditLog).where(and(eq(auditLog.entityId, r.id), eq(auditLog.action, 'enquiry.status')))).toHaveLength(2);
    const err = await db.execute(sql`DELETE FROM enquiries WHERE id = ${r.id}`).then(() => null, (e: Error) => e);
    expect(err).not.toBeNull();
  });
});

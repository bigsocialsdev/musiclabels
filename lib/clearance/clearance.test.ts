import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq, sql } from 'drizzle-orm';
import { auditLog, channelVerifications, clearanceRequests, licensedChannels, outbox, sellerProfiles, tracks } from '@/db/schema';
import { addChannel } from '@/lib/licensing/server';
import { closeDb, getDb } from '@/lib/platform/db';
import { adminCtx, sale, setupCommerce } from '@/tests/commerce';
import { makeSeller } from '@/tests/factories';
import { FakeGateway, MemoryStore } from '@/tests/fakes';
import {
  CLEARANCE_STATUSES,
  CLEARANCE_EVENTS,
  CLEARANCE_TRANSITIONS,
  addChannelWithClearance,
  adminConfirmChannel,
  backfillClearance,
  checkBioCode,
  dispatchClearance,
  ensureClearanceRequests,
  escalateClearance,
  hashToken,
  listClearanceQueue,
  markOverdue,
  nextClearanceStatus,
  parseYoutubeChannel,
  peekResponse,
  registerVideoWithClearance,
  replaceChannelWithClearance,
  resendClearance,
  resolveClearance,
  respondToClearance,
  sellerTurnaround,
  startBioCodeVerification,
} from './server';

afterAll(closeDb);
const db = getDb();
const run = Math.random().toString(36).slice(2, 10); // addresses are unique per run so a re-run against a used database still counts right
const e_late_ops = `late-ops-${run}@seller.example`;
const e_once = `once-${run}@seller.example`;
const e_replaced = `replaced-${run}@seller.example`;
const gw = new FakeGateway();
const store = new MemoryStore();

beforeAll(() => setupCommerce(db, { L1: 100_000, L2: 100_000, L3: 100_000, L4: 100_000, L5: 100_000 }));

const requests = (licenseId: string) => db.select().from(clearanceRequests).where(eq(clearanceRequests.licenseId, licenseId));
const mails = async (kind: string) => db.select().from(outbox).where(eq(outbox.kind, kind)).orderBy(desc(outbox.createdAt));
const dbMessage = async (q: ReturnType<typeof sql>) => {
  const err = await db.execute(q).then(() => null, (e: Error) => e);
  return ((err?.cause as Error | undefined) ?? err)?.message;
};
const tokenOf = (mail: { payload: unknown }) => ((mail.payload as { respondUrl: string }).respondUrl.split('/').pop() as string);
const classB = () => sale(db, gw, store, { clearanceClass: 'B' });
const buyerActor = (s: Awaited<ReturnType<typeof sale>>) => ({ userId: s.buyer.owner.userId, orgId: s.buyer.orgId });
const video = (n = 1) => ({ label: `Ad ${Math.random()}`, urls: [`https://youtube.com/watch?v=${Math.random().toString(36).slice(2)}`].slice(0, n) });

/** The plaintext token of the license's first request: found by matching the stored hash against the emails sent. */
async function liveToken(licenseId: string): Promise<string> {
  const [r] = await requests(licenseId);
  const rows = await db.select().from(outbox).where(eq(outbox.template, 'clearance_request')).orderBy(desc(outbox.createdAt)).limit(200);
  const found = rows.map(tokenOf).find((tok) => hashToken(tok) === r!.respondTokenHash);
  if (!found) throw new Error('no email carries the live token');
  return found;
}

/** The mail sent to a seller's ops contact for this request: the one whose payload mentions it, newest first. */
async function latestRequestMail(requestEmail: string, kind = 'clearance.request') {
  return (await db.select().from(outbox).where(and(eq(outbox.kind, kind), eq(outbox.to, requestEmail))).orderBy(desc(outbox.createdAt)))[0]!;
}

describe('clearance state machine (PLAN 4.5)', () => {
  it('matches the transition table for every status × event pair', () => {
    for (const from of CLEARANCE_STATUSES) {
      for (const event of CLEARANCE_EVENTS) {
        const expected = CLEARANCE_TRANSITIONS.find((t) => t.from === from && t.event === event)?.to ?? null;
        expect(nextClearanceStatus(from, event)).toBe(expected);
      }
    }
    expect(nextClearanceStatus('not_required', 'send')).toBeNull();
    expect(nextClearanceStatus('completed', 'fail')).toBeNull();
    expect(nextClearanceStatus('sent', 'escalate')).toBeNull(); // only overdue escalates
  });

  it('the database enforces the same moves and keeps identity columns fixed', async () => {
    const s = await classB();
    const [r] = await requests(s.licenseId!);
    expect(await dbMessage(sql`UPDATE clearance_requests SET status = 'pending' WHERE id = ${r!.id}`)).toMatch(/sent -> pending is not allowed/);
    expect(await dbMessage(sql`UPDATE clearance_requests SET status = 'escalated' WHERE id = ${r!.id}`)).toMatch(/sent -> escalated is not allowed/);
    expect(await dbMessage(sql`UPDATE clearance_requests SET seller_org_id = ${s.buyer.orgId} WHERE id = ${r!.id}`)).toMatch(/only status and response fields/);
    expect(await dbMessage(sql`DELETE FROM clearance_requests WHERE id = ${r!.id}`)).toBeTruthy();
    await db.execute(sql`UPDATE clearance_requests SET status = 'completed', responded_at = now() WHERE id = ${r!.id}`);
    expect(await dbMessage(sql`UPDATE clearance_requests SET status = 'failed' WHERE id = ${r!.id}`)).toMatch(/completed -> failed is not allowed/);
    expect(await dbMessage(sql`UPDATE clearance_requests SET responded_at = now() + interval '1 day' WHERE id = ${r!.id}`)).toMatch(/write-once/);
  });
});

describe('requests are created with the license (PLAN 5.2 b, 4.5)', () => {
  it('Class A license ⇒ not_required, nothing sent', async () => {
    const s = await sale(db, gw, store, { clearanceClass: 'A' });
    const rows = await requests(s.licenseId!);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ scope: 'channel', status: 'not_required', clearanceClass: 'A', sentAt: null, dueAt: null, respondTokenHash: null });
    expect(await dispatchClearance(db, { licenseId: s.licenseId! })).toBe(0);
  });

  it('Class B ⇒ one request per channel, sent to the seller with a due date one business day on', async () => {
    const s = await classB();
    const rows = await requests(s.licenseId!);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ scope: 'channel', status: 'sent', clearanceClass: 'B', provider: 'manual_seller', sellerOrgId: s.sellerOrgId });
    const sentAt = rows[0]!.sentAt!;
    expect(rows[0]!.dueAt!.getTime()).toBeGreaterThan(sentAt.getTime());
    expect(rows[0]!.dueAt!.getTime() - sentAt.getTime()).toBeLessThanOrEqual(3 * 86_400_000 + 1000); // across a weekend at most
    const mail = await latestRequestMail('ops@seller.example');
    expect(mail.template).toBe('clearance_request');
    expect((mail.payload as { what: string }).what).toContain('youtube channel @b');
  });

  it('only the hash of the response token is stored', async () => {
    const s = await classB();
    const [r] = await requests(s.licenseId!);
    const token = await liveToken(s.licenseId!);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r!.respondTokenHash).toBe(hashToken(token));
    expect(r!.respondTokenHash).not.toContain(token);
    expect(r!.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);
  });

  it('a new channel and each registered video get their own request (Class B), and A gets not_required', async () => {
    const b = await classB();
    expect((await addChannelWithClearance(db, buyerActor(b), b.licenseId!, { platform: 'instagram', handleOrUrl: '@brand' })).ok).toBe(true);
    const v = await registerVideoWithClearance(db, buyerActor(b), b.licenseId!, video());
    expect(v.ok).toBe(true);
    let rows = await requests(b.licenseId!);
    expect(rows.map((r) => r.scope).sort()).toEqual(['channel', 'channel', 'video']);
    expect(rows.filter((r) => r.status === 'pending')).toHaveLength(2); // sent by the dispatcher
    expect(await dispatchClearance(db, { licenseId: b.licenseId! })).toBe(2);
    rows = await requests(b.licenseId!);
    expect(rows.every((r) => r.status === 'sent')).toBe(true);

    const a = await sale(db, gw, store, { clearanceClass: 'A' });
    await registerVideoWithClearance(db, buyerActor(a), a.licenseId!, video());
    expect((await requests(a.licenseId!)).map((r) => r.status)).toEqual(['not_required', 'not_required']);
  });

  it('a failed registration creates no request, and a track reclassified C gets none', async () => {
    const s = await classB();
    const over = await registerVideoWithClearance(db, { userId: s.buyer.owner.userId, orgId: s.sellerOrgId }, s.licenseId!, video());
    expect(over.ok).toBe(false); // wrong org
    expect(await requests(s.licenseId!)).toHaveLength(1);
    await db.update(tracks).set({ clearanceClass: 'C' }).where(eq(tracks.id, s.trackId));
    expect((await registerVideoWithClearance(db, buyerActor(s), s.licenseId!, video())).ok).toBe(true);
    expect(await requests(s.licenseId!)).toHaveLength(1);
  });

  it('ensure is idempotent, also when run concurrently', async () => {
    const s = await classB();
    await addChannel(db, buyerActor(s), s.licenseId!, { platform: 'facebook', handleOrUrl: 'brand' }); // bypasses the wrapper
    await Promise.all(Array.from({ length: 5 }, () => db.transaction((tx) => ensureClearanceRequests(tx, s.licenseId!))));
    expect(await requests(s.licenseId!)).toHaveLength(2);
    expect(await db.transaction((tx) => ensureClearanceRequests(tx, s.licenseId!))).toBe(0);
  });

  it('the sweep backfills a license whose channel has no request', async () => {
    const s = await classB();
    const added = await addChannel(db, buyerActor(s), s.licenseId!, { platform: 'facebook', handleOrUrl: 'late' });
    expect(added.ok).toBe(true);
    expect(await requests(s.licenseId!)).toHaveLength(1);
    expect(await backfillClearance(db)).toBeGreaterThanOrEqual(1);
    expect(await requests(s.licenseId!)).toHaveLength(2);
  });

  it('a seller with no ops contact leaves the request pending with the reason; it goes out once there is one', async () => {
    const seller = await makeSeller(db, { opsEmail: null });
    const s = await sale(db, gw, store, { clearanceClass: 'B', sellerOrgId: seller.orgId });
    const [r] = await requests(s.licenseId!);
    expect(r).toMatchObject({ status: 'pending' });
    expect(r!.lastError).toMatch(/no ops contact/);
    await db.update(sellerProfiles).set({ opsContactEmail: e_late_ops }).where(eq(sellerProfiles.orgId, seller.orgId));
    expect(await dispatchClearance(db, { licenseId: s.licenseId! })).toBe(1);
    expect((await requests(s.licenseId!))[0]).toMatchObject({ status: 'sent', lastError: null });
    expect(await latestRequestMail(e_late_ops)).toBeTruthy();
  });

  it('dispatching twice (or concurrently) sends one email', async () => {
    const seller = await makeSeller(db, { opsEmail: null });
    const s = await sale(db, gw, store, { clearanceClass: 'B', sellerOrgId: seller.orgId });
    await db.update(sellerProfiles).set({ opsContactEmail: e_once }).where(eq(sellerProfiles.orgId, seller.orgId));
    const counts = await Promise.all([dispatchClearance(db, { licenseId: s.licenseId! }), dispatchClearance(db, { licenseId: s.licenseId! })]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await db.select().from(outbox).where(eq(outbox.to, e_once))).toHaveLength(1);
  });

  it('a replaced channel\'s request is history: not sent, not chased', async () => {
    const seller = await makeSeller(db, { opsEmail: null });
    const s = await sale(db, gw, store, { clearanceClass: 'B', sellerOrgId: seller.orgId });
    const [old] = await db.select({ id: licensedChannels.id }).from(licensedChannels).where(eq(licensedChannels.licenseId, s.licenseId!));
    expect((await replaceChannelWithClearance(db, buyerActor(s), s.licenseId!, old!.id, { platform: 'youtube', handleOrUrl: '@new' })).ok).toBe(true);
    await db.update(sellerProfiles).set({ opsContactEmail: e_replaced }).where(eq(sellerProfiles.orgId, seller.orgId));
    expect(await dispatchClearance(db, { licenseId: s.licenseId! })).toBe(1); // only the new channel
    const rows = await requests(s.licenseId!);
    expect(rows.find((r) => r.licensedChannelId === old!.id)!.status).toBe('pending');
    expect(await db.select().from(outbox).where(eq(outbox.to, e_replaced))).toHaveLength(1);
  });
});

describe('overdue (PLAN 4.5)', () => {
  it('is overdue only after due_at; the seller gets a reminder with a fresh link, the buyer and ops are told, once', async () => {
    const s = await classB();
    const [r] = await requests(s.licenseId!);
    const firstToken = await liveToken(s.licenseId!);
    expect(await markOverdue(db, 1000)).toBe(0); // not yet due: this request stays sent
    expect((await requests(s.licenseId!))[0]!.status).toBe('sent');

    await db.update(clearanceRequests).set({ dueAt: sql`now() - interval '1 minute'` }).where(eq(clearanceRequests.id, r!.id));
    await markOverdue(db, 1000);
    expect((await requests(s.licenseId!))[0]!.status).toBe('overdue');
    expect(await markOverdue(db, 1000)).toBe(0); // idempotent

    const reminder = await latestRequestMail('ops@seller.example', 'clearance.reminder');
    const newToken = tokenOf(reminder);
    expect(newToken).not.toBe(firstToken);
    expect((await requests(s.licenseId!))[0]!.respondTokenHash).toBe(hashToken(newToken));
    expect(await peekResponse(db, firstToken)).toBeNull(); // the old link no longer works
    expect(await peekResponse(db, newToken)).toMatchObject({ status: 'overdue' });
    expect(await db.select().from(outbox).where(and(eq(outbox.kind, 'clearance.overdue'), eq(outbox.to, s.buyer.owner.email!)))).toHaveLength(1);
    expect((await mails('alert.clearance_overdue')).length).toBeGreaterThan(0);
    expect(await db.select().from(auditLog).where(and(eq(auditLog.entityId, r!.id), eq(auditLog.action, 'clearance.mark_overdue')))).toHaveLength(1);
  });

  it('an overdue request can still be completed by the seller', async () => {
    const s = await classB();
    const [r] = await requests(s.licenseId!);
    await db.update(clearanceRequests).set({ dueAt: sql`now() - interval '1 minute'` }).where(eq(clearanceRequests.id, r!.id));
    await markOverdue(db, 1000);
    const token = await liveToken(s.licenseId!);
    expect(await respondToClearance(db, token, { outcome: 'released' })).toEqual({ ok: true, outcome: 'released' });
    expect((await requests(s.licenseId!))[0]!.status).toBe('completed');
  });
});

describe('seller response link (PLAN 4.5)', () => {
  it('viewing never consumes it; one answer completes the request, notifies the buyer and clears the token', async () => {
    const s = await classB();
    const token = await liveToken(s.licenseId!);
    expect(await peekResponse(db, token)).toMatchObject({ status: 'sent', what: expect.stringContaining('@b') });
    expect(await peekResponse(db, token)).not.toBeNull(); // still valid after viewing

    expect(await respondToClearance(db, token, { outcome: 'released', note: 'Allowlisted on the CMS' })).toEqual({ ok: true, outcome: 'released' });
    const [r] = await requests(s.licenseId!);
    expect(r).toMatchObject({ status: 'completed', respondTokenHash: null, tokenExpiresAt: null, sellerNote: 'Allowlisted on the CMS' });
    expect(r!.respondedAt).not.toBeNull();
    expect(await db.select().from(outbox).where(and(eq(outbox.kind, 'clearance.completed'), eq(outbox.to, s.buyer.owner.email!)))).toHaveLength(1);
    expect(await db.select().from(auditLog).where(and(eq(auditLog.entityId, r!.id), eq(auditLog.action, 'clearance.complete')))).toHaveLength(1);
  });

  it('is single use: a second answer, a concurrent answer, and an answer with the old link all find nothing', async () => {
    const s = await classB();
    const token = await liveToken(s.licenseId!);
    const results = await Promise.all([respondToClearance(db, token, { outcome: 'released' }), respondToClearance(db, token, { outcome: 'declined' })]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, reason: 'invalid' });
    expect(await respondToClearance(db, token, { outcome: 'declined' })).toEqual({ ok: false, reason: 'invalid' });
    const rows = await requests(s.licenseId!);
    expect(['completed', 'failed']).toContain(rows[0]!.status); // decided once, by whoever won
    expect(await db.select().from(auditLog).where(and(eq(auditLog.entityId, rows[0]!.id), sql`${auditLog.action} in ('clearance.complete','clearance.fail')`))).toHaveLength(1);
  });

  it('expires: an expired token is the same as an unknown one', async () => {
    const s = await classB();
    const token = await liveToken(s.licenseId!);
    await db.update(clearanceRequests).set({ tokenExpiresAt: sql`now() - interval '1 second'` }).where(eq(clearanceRequests.licenseId, s.licenseId!));
    expect(await peekResponse(db, token)).toBeNull();
    expect(await respondToClearance(db, token, { outcome: 'released' })).toEqual({ ok: false, reason: 'invalid' });
    expect(await respondToClearance(db, 'x'.repeat(43), { outcome: 'released' })).toEqual({ ok: false, reason: 'invalid' });
    expect((await requests(s.licenseId!))[0]!.status).toBe('sent');
  });

  it('rejects an answer that is not released or declined, without consuming the token', async () => {
    await classB();
    const s = await classB();
    const token = await liveToken(s.licenseId!);
    expect(await respondToClearance(db, token, { outcome: 'maybe' })).toEqual({ ok: false, reason: 'bad_input' });
    expect(await respondToClearance(db, token, {})).toEqual({ ok: false, reason: 'bad_input' });
    expect(await peekResponse(db, token)).not.toBeNull();
    expect(s.licenseId).toBeTruthy();
  });

  it('declining fails the request, tells the buyer and alerts ops (the refund path opens; a person decides)', async () => {
    const s = await classB();
    const token = await liveToken(s.licenseId!);
    expect(await respondToClearance(db, token, { outcome: 'declined', note: 'Cannot allowlist' })).toEqual({ ok: true, outcome: 'declined' });
    expect((await requests(s.licenseId!))[0]).toMatchObject({ status: 'failed', respondTokenHash: null });
    expect(await db.select().from(outbox).where(and(eq(outbox.kind, 'clearance.failed'), eq(outbox.to, s.buyer.owner.email!)))).toHaveLength(1);
    expect((await mails('alert.clearance_failed')).length).toBeGreaterThan(0);
  });
});

describe('admin clearance queue (PLAN 9)', () => {
  it('needs the clearance permission; lists work (not Class A), escalates overdue, resolves with evidence, resends', async () => {
    const s = await classB();
    const [r] = await requests(s.licenseId!);
    const admin = await adminCtx(db, ['clearance']);
    await expect(listClearanceQueue(db, await adminCtx(db, ['disputes']))).rejects.toThrow(/clearance/);

    const queue = await listClearanceQueue(db, admin, { status: 'sent' });
    expect(queue.find((q) => q.id === r!.id)).toMatchObject({ seller: expect.any(String), clearanceClass: 'B', target: 'youtube @b' });
    const a = await sale(db, gw, store, { clearanceClass: 'A' });
    const notRequired = (await requests(a.licenseId!))[0]!.id;
    expect((await listClearanceQueue(db, admin)).some((q) => q.id === notRequired)).toBe(false);

    expect(await escalateClearance(db, admin, r!.id)).toMatchObject({ ok: false, reason: 'invalid' }); // sent cannot escalate
    await db.update(clearanceRequests).set({ dueAt: sql`now() - interval '1 minute'` }).where(eq(clearanceRequests.id, r!.id));
    await markOverdue(db, 1000);
    expect(await escalateClearance(db, admin, r!.id)).toMatchObject({ ok: true, to: 'escalated' });

    const before = await liveToken(s.licenseId!);
    expect(await resendClearance(db, admin, r!.id)).toEqual({ ok: true });
    const after = await liveToken(s.licenseId!);
    expect(after).not.toBe(before);
    expect(await peekResponse(db, before)).toBeNull();

    await expect(resolveClearance(db, admin, r!.id, { outcome: 'released', note: ' ' })).rejects.toThrow(/note/);
    expect(await resolveClearance(db, admin, r!.id, { outcome: 'released', note: 'Seller confirmed by phone' })).toEqual({ ok: true });
    expect((await requests(s.licenseId!))[0]).toMatchObject({ status: 'completed', sellerNote: 'Seller confirmed by phone', respondTokenHash: null });
    expect(await resolveClearance(db, admin, r!.id, { outcome: 'declined', note: 'again' })).toMatchObject({ ok: false });
    expect(await resendClearance(db, admin, r!.id)).toEqual({ ok: false });
    const acts = (await db.select({ a: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, r!.id))).map((x) => x.a);
    expect(acts).toEqual(expect.arrayContaining(['clearance.send', 'clearance.mark_overdue', 'clearance.escalate', 'clearance.resend', 'clearance.complete']));
  });

  it('tracks per-seller turnaround for delisting decisions', async () => {
    const seller = await makeSeller(db);
    const admin = await adminCtx(db, ['clearance']);
    const fast = await sale(db, gw, store, { clearanceClass: 'B', sellerOrgId: seller.orgId });
    const slow = await sale(db, gw, store, { clearanceClass: 'B', sellerOrgId: seller.orgId });
    const waiting = await sale(db, gw, store, { clearanceClass: 'B', sellerOrgId: seller.orgId });
    expect(await respondToClearance(db, await liveToken(fast.licenseId!), { outcome: 'released' })).toMatchObject({ ok: true });
    const [slowReq] = await requests(slow.licenseId!);
    await db.update(clearanceRequests).set({ dueAt: sql`now() - interval '2 hours'` }).where(eq(clearanceRequests.id, slowReq!.id));
    await markOverdue(db, 1000);
    expect(await respondToClearance(db, await liveToken(waiting.licenseId!), { outcome: 'declined' })).toMatchObject({ ok: true });
    const t = await sellerTurnaround(db, admin, seller.orgId);
    expect(t).toMatchObject({ completed: 1, failed: 1, overdue: 1, awaiting: 0 });
    expect(t.avgResponseHours).not.toBeNull();
  });
});

describe('channel verification by bio code (PLAN 11)', () => {
  const channelOf = async (licenseId: string) => (await db.select().from(licensedChannels).where(eq(licensedChannels.licenseId, licenseId)))[0]!;

  it('start gives a code; a bio without it stays pending, a bio with it verifies the channel', async () => {
    const s = await classB();
    const ch = await channelOf(s.licenseId!);
    const started = await startBioCodeVerification(db, buyerActor(s), ch.id);
    if (!started.ok) throw new Error(started.reason);
    expect(started.value.code).toMatch(/^MRM-[2-9A-HJKMNP-Z]{8}$/);
    expect((await channelOf(s.licenseId!)).verificationStatus).toBe('pending');
    const again = await startBioCodeVerification(db, buyerActor(s), ch.id);
    expect(again.ok && again.value.code).toBe(started.value.code); // the open challenge, not a new one

    expect(await checkBioCode(db, buyerActor(s), ch.id, async () => 'Official channel of Buyer Media')).toEqual({ ok: true, value: 'code_not_found' });
    expect((await channelOf(s.licenseId!)).verificationStatus).toBe('pending');
    expect(await checkBioCode(db, buyerActor(s), ch.id, async () => `Hello. ${started.value.code.toLowerCase()} thanks`)).toEqual({ ok: true, value: 'verified' });
    expect((await channelOf(s.licenseId!)).verificationStatus).toBe('verified');
    expect((await db.select().from(channelVerifications).where(eq(channelVerifications.licensedChannelId, ch.id)))[0]).toMatchObject({ status: 'verified', checkedBy: null });
    expect(await startBioCodeVerification(db, buyerActor(s), ch.id)).toEqual({ ok: false, reason: 'already_verified' });
  });

  it('a fetch failure is reported and recorded, not treated as a mismatch', async () => {
    const s = await classB();
    const ch = await channelOf(s.licenseId!);
    await startBioCodeVerification(db, buyerActor(s), ch.id);
    expect(await checkBioCode(db, buyerActor(s), ch.id, async () => { throw new Error('YouTube API 403'); })).toEqual({ ok: true, value: 'check_failed' });
    expect((await db.select().from(channelVerifications).where(eq(channelVerifications.licensedChannelId, ch.id)))[0]!.lastError).toMatch(/403/);
  });

  it('another org cannot start or check it; Instagram and without an API key need an admin, who is audited', async () => {
    const s = await classB();
    const ch = await channelOf(s.licenseId!);
    const stranger = { userId: s.buyer.owner.userId, orgId: s.sellerOrgId };
    expect(await startBioCodeVerification(db, stranger, ch.id)).toEqual({ ok: false, reason: 'not_found' });
    expect(await checkBioCode(db, stranger, ch.id, async () => 'x')).toEqual({ ok: false, reason: 'not_found' });

    const ig = await addChannel(db, buyerActor(s), s.licenseId!, { platform: 'instagram', handleOrUrl: '@brand' });
    if (!ig.ok) throw new Error('addChannel');
    const igStart = await startBioCodeVerification(db, buyerActor(s), ig.value.channelId);
    expect(igStart.ok && igStart.value.autoCheck).toBe(false);
    expect(await checkBioCode(db, buyerActor(s), ig.value.channelId, async () => 'anything')).toEqual({ ok: true, value: 'manual_check_required' });
    expect(await checkBioCode(db, buyerActor(s), ch.id, null)).toEqual({ ok: true, value: 'no_challenge' });

    const admin = await adminCtx(db, ['clearance']);
    await expect(adminConfirmChannel(db, await adminCtx(db, ['disputes']), ig.value.channelId)).rejects.toThrow(/clearance/);
    expect(await adminConfirmChannel(db, admin, ig.value.channelId)).toEqual({ ok: true });
    expect((await db.select().from(licensedChannels).where(eq(licensedChannels.id, ig.value.channelId)))[0]!.verificationStatus).toBe('verified');
    expect((await db.select().from(channelVerifications).where(eq(channelVerifications.licensedChannelId, ig.value.channelId)))[0]!.checkedBy).toBe(admin.userId);
    expect(await db.select().from(auditLog).where(and(eq(auditLog.entityId, ig.value.channelId), eq(auditLog.action, 'channel.verify')))).toHaveLength(1);
    expect(await adminConfirmChannel(db, admin, ig.value.channelId)).toEqual({ ok: false, reason: 'no_challenge' });
  });

  it('only a handle or channel id reaches the YouTube API: other hosts and non-channel pages are not checked', () => {
    expect(parseYoutubeChannel('@creator')).toEqual({ handle: '@creator' });
    expect(parseYoutubeChannel('creator')).toEqual({ handle: '@creator' });
    expect(parseYoutubeChannel('https://www.youtube.com/@creator')).toEqual({ handle: '@creator' });
    expect(parseYoutubeChannel('https://youtube.com/channel/UCabcdefghijklmnopqrstuv')).toEqual({ id: 'UCabcdefghijklmnopqrstuv' });
    expect(parseYoutubeChannel('UCabcdefghijklmnopqrstuv')).toEqual({ id: 'UCabcdefghijklmnopqrstuv' });
    expect(parseYoutubeChannel('https://evil.example/@creator')).toBeNull();
    expect(parseYoutubeChannel('https://www.youtube.com/watch?v=abc')).toBeNull();
    expect(parseYoutubeChannel('https://www.youtube.com/playlist?list=PL1')).toBeNull();
    expect(parseYoutubeChannel('http://169.254.169.254/latest')).toBeNull();
    expect(parseYoutubeChannel('a b')).toBeNull();
  });
});

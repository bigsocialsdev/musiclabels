import { afterAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { trackEvents, tracks } from '@/db/schema';
import { closeDb, getDb } from '@/lib/platform/db';
import { makeSeller, makeTrack } from '@/tests/factories';
import { TRACK_EVENTS, TRACK_STATUSES, TRACK_TRANSITIONS, nextStatus } from './index';
import { applyTransition } from './internal/transition';

afterAll(closeDb);
const db = getDb();

describe('transition table', () => {
  it('allows exactly the transitions in PLAN 4.1', () => {
    for (const from of TRACK_STATUSES) {
      for (const event of TRACK_EVENTS) {
        const expected = TRACK_TRANSITIONS.find((t) => t.from === from && t.event === event)?.to ?? null;
        expect(nextStatus(from, event)).toBe(expected);
      }
    }
    expect(TRACK_TRANSITIONS).toHaveLength(10);
  });

  it('has no way out of delisted, and published is only reachable by approve or reinstate', () => {
    expect(TRACK_EVENTS.every((e) => nextStatus('delisted', e) === null)).toBe(true);
    const into = TRACK_TRANSITIONS.filter((t) => t.to === 'published').map((t) => t.event);
    expect(into.sort()).toEqual(['approve', 'reinstate']);
  });
});

describe('applyTransition against the database', () => {
  it('applies every allowed transition and rejects every disallowed one without changing the row', async () => {
    const { orgId } = await makeSeller(db);
    for (const from of TRACK_STATUSES) {
      for (const event of TRACK_EVENTS) {
        const id = await makeTrack(db, orgId, from);
        const to = nextStatus(from, event);
        const r = await applyTransition(db, id, event, null);
        const [row] = await db.select({ status: tracks.status }).from(tracks).where(eq(tracks.id, id));
        if (to) {
          expect(r).toEqual({ ok: true, from, to });
          expect(row!.status).toBe(to);
        } else {
          expect(r).toEqual({ ok: false, reason: 'invalid', status: from });
          expect(row!.status).toBe(from);
        }
      }
    }
  });

  it('writes an event row per transition and none for refused ones', async () => {
    const { orgId } = await makeSeller(db);
    const id = await makeTrack(db, orgId, 'draft');
    await applyTransition(db, id, 'submit', null, { reason: 'go' });
    await applyTransition(db, id, 'approve', null); // invalid from submitted
    const events = await db.select().from(trackEvents).where(eq(trackEvents.trackId, id));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ fromStatus: 'draft', toStatus: 'submitted', event: 'submit', reason: 'go' });
  });

  it('exactly one of two concurrent moves wins; the loser changes nothing', async () => {
    const { orgId } = await makeSeller(db);
    const id = await makeTrack(db, orgId, 'in_review');
    const results = await Promise.all([applyTransition(db, id, 'approve', null), applyTransition(db, id, 'reject', null)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const events = await db.select().from(trackEvents).where(eq(trackEvents.trackId, id));
    expect(events).toHaveLength(1);
  });

  it('reports not_found and keeps track_events append-only', async () => {
    expect(await applyTransition(db, crypto.randomUUID(), 'submit', null)).toEqual({ ok: false, reason: 'not_found' });
    const err = await db.execute(sql`DELETE FROM track_events`).then(
      () => null,
      (e: Error) => e,
    );
    expect(((err?.cause as Error | undefined) ?? err)?.message).toMatch(/append-only/);
  });
});

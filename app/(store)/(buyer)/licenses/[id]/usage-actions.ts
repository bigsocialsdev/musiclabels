'use server';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { requireBuyerSession } from '@/app/buyer-session';
import {
  addChannelWithClearance,
  checkBioCode,
  dispatchClearance,
  registerVideoWithClearance,
  replaceChannelWithClearance,
  startBioCodeVerification,
} from '@/lib/clearance/server';
import { openDispute, disputeInputSchema } from '@/lib/disputes/server';
import { addVideoUrl, channelInputSchema, resolveBuyerActor, videoInputSchema, videoUrlSchema } from '@/lib/licensing/server';
import { getDb } from '@/lib/platform/db';
import { kick } from '@/lib/platform/tasks';

const uuid = z.uuid();
const text = (form: FormData, name: string) => String(form.get(name) ?? '');

/** The buyer's actor for this license, or a 404: another org's license is indistinguishable from a missing one. */
async function actorFor(licenseId: string) {
  const id = uuid.parse(licenseId);
  const session = await requireBuyerSession(`/licenses/${id}`);
  const db = getDb();
  const actor = await resolveBuyerActor(db, session.userId, id);
  if (!actor) notFound();
  return { db, actor, id };
}

const back = (id: string, query: string, hash = '') => redirect(`/licenses/${id}?${query}${hash}`);
const sendClearance = (licenseId: string) => kick('dispatchClearance', () => dispatchClearance(getDb(), { licenseId }));

export async function addChannelAction(licenseId: string, form: FormData) {
  const { db, actor, id } = await actorFor(licenseId);
  const input = channelInputSchema.safeParse({ platform: text(form, 'platform'), handleOrUrl: text(form, 'handleOrUrl') });
  if (!input.success) back(id, 'error=invalid_channel', '#channels');
  const r = await addChannelWithClearance(db, actor, id, input.data!);
  if (!r.ok) back(id, `error=${r.issues[0]}`, '#channels');
  sendClearance(id);
  back(id, 'done=channel_added', '#channels');
}

export async function registerVideoAction(licenseId: string, form: FormData) {
  const { db, actor, id } = await actorFor(licenseId);
  const input = videoInputSchema.safeParse({ label: text(form, 'label'), urls: text(form, 'urls').split(/[\s,]+/).filter(Boolean) });
  if (!input.success) back(id, 'error=invalid_video', '#videos');
  const r = await registerVideoWithClearance(db, actor, id, input.data!);
  if (!r.ok) back(id, `error=${r.issues[0]}`, '#videos');
  sendClearance(id);
  back(id, 'done=video_registered', '#videos');
}

export async function addVideoUrlAction(licenseId: string, videoId: string, form: FormData) {
  const { db, actor, id } = await actorFor(licenseId);
  const url = videoUrlSchema.safeParse(text(form, 'url').trim());
  if (!url.success) back(id, 'error=invalid_url', '#videos');
  const r = await addVideoUrl(db, actor, id, uuid.parse(videoId), url.data!);
  if (!r.ok) back(id, `error=${r.issues[0]}`, '#videos');
  back(id, 'done=url_added', '#videos');
}

const channelPage = (id: string, channelId: string, query = '') => `/licenses/${id}/channels/${channelId}${query}`;

/** Asks for (or re-reads) the channel's open code, then shows it. */
export async function startVerifyAction(licenseId: string, channelId: string) {
  const { db, actor, id } = await actorFor(licenseId);
  const cid = uuid.parse(channelId);
  const r = await startBioCodeVerification(db, actor, cid);
  if (!r.ok && r.reason === 'not_found') notFound();
  redirect(channelPage(id, cid));
}

export async function checkVerifyAction(licenseId: string, channelId: string) {
  const { db, actor, id } = await actorFor(licenseId);
  const cid = uuid.parse(channelId);
  const r = await checkBioCode(db, actor, cid);
  if (!r.ok) notFound();
  redirect(channelPage(id, cid, `?result=${r.value}`));
}

/** A correction of the handle: only before any video is registered, at most twice (the licensing slice decides). */
export async function replaceChannelAction(licenseId: string, channelId: string, form: FormData) {
  const { db, actor, id } = await actorFor(licenseId);
  const cid = uuid.parse(channelId);
  const input = channelInputSchema.safeParse({ platform: text(form, 'platform'), handleOrUrl: text(form, 'handleOrUrl') });
  if (!input.success) redirect(channelPage(id, cid, '?error=invalid_channel'));
  const r = await replaceChannelWithClearance(db, actor, id, cid, input.data!);
  if (!r.ok) redirect(channelPage(id, cid, `?error=${r.issues[0]}`));
  sendClearance(id);
  back(id, 'done=channel_corrected', '#channels');
}

export async function openDisputeAction(licenseId: string, form: FormData) {
  const { db, actor, id } = await actorFor(licenseId);
  const input = disputeInputSchema.safeParse({
    videoUrl: text(form, 'videoUrl').trim(),
    platform: text(form, 'platform'),
    disputeType: text(form, 'disputeType'),
    claimantName: text(form, 'claimantName'),
  });
  if (!input.success) redirect(`/licenses/${id}/disputes?error=invalid_dispute`);
  const r = await openDispute(db, actor, id, input.data!);
  if (!r.ok) redirect(`/licenses/${id}/disputes?error=${r.issues[0]}`);
  redirect(`/licenses/${id}/disputes?done=opened`);
}

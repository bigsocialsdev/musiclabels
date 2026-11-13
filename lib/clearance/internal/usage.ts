import { addChannel, registerVideo, replaceChannel, type BuyerActor, type ChannelInput, type Result, type VideoInput } from '@/lib/licensing/server';
import type { DbOrTx } from '@/lib/platform/db';
import { ensureClearanceRequests } from './requests';

/**
 * Buyer actions that change what a license is used on. Each runs the licensing action and creates the clearance
 * request for the new channel or video in the same transaction (PLAN §5.3: registering a URL for a Class B
 * license creates a video-scope request). The buyer UI calls these, not the licensing functions directly; if it
 * ever did, the daily sweep fills in the missing request. After commit the caller kicks `dispatchClearance`.
 */
export const addChannelWithClearance = (db: DbOrTx, actor: BuyerActor, licenseId: string, input: ChannelInput): Promise<Result<{ channelId: string }>> =>
  db.transaction(async (tx) => {
    const r = await addChannel(tx, actor, licenseId, input);
    if (r.ok) await ensureClearanceRequests(tx, licenseId);
    return r;
  });

export const replaceChannelWithClearance = (db: DbOrTx, actor: BuyerActor, licenseId: string, channelId: string, input: ChannelInput): Promise<Result<{ channelId: string }>> =>
  db.transaction(async (tx) => {
    const r = await replaceChannel(tx, actor, licenseId, channelId, input);
    if (r.ok) await ensureClearanceRequests(tx, licenseId);
    return r;
  });

export const registerVideoWithClearance = (db: DbOrTx, actor: BuyerActor, licenseId: string, input: VideoInput): Promise<Result<{ videoId: string }>> =>
  db.transaction(async (tx) => {
    const r = await registerVideo(tx, actor, licenseId, input);
    if (r.ok) await ensureClearanceRequests(tx, licenseId);
    return r;
  });

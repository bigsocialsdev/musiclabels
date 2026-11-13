import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { Notice, Page, PageHeader, selectClass } from '@/app/seller/ui';
import { requireBuyerSession } from '@/app/buyer-session';
import { CopyButton } from '@/components/store/copy-button';
import { PLATFORM_LABELS } from '@/components/store/format';
import { Button } from '@/components/ui/button';
import { getBioChallenge } from '@/lib/clearance/server';
import { resolveBuyerActor } from '@/lib/licensing/server';
import { getDb } from '@/lib/platform/db';
import { checkVerifyAction, replaceChannelAction, startVerifyAction } from '../../usage-actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Verify channel | MRM', robots: { index: false } };

const RESULTS: Record<string, { tone: 'ok' | 'attention' | 'info'; text: string }> = {
  verified: { tone: 'ok', text: 'Verified. We found the code, so this channel is confirmed as yours.' },
  code_not_found: { tone: 'attention', text: 'We could not find the code in the description yet. Save the change, wait a few minutes, then check again.' },
  manual_check_required: { tone: 'info', text: 'Our team confirms this platform by hand once the code is on your profile. The channel shows as pending until then.' },
  check_failed: { tone: 'attention', text: 'We could not read the channel just now. Try again in a minute.' },
  rate_limited: { tone: 'attention', text: 'That is a lot of checks. Wait a minute and try again.' },
  no_challenge: { tone: 'attention', text: 'Get a code first, then check.' },
};
const ERRORS: Record<string, string> = {
  invalid_channel: "Enter the channel's handle or link.",
  platform_not_allowed: 'That platform is not covered by this license.',
  duplicate_channel: 'That channel is already on this license.',
  channel_not_found: 'That channel is no longer on this license.',
  videos_registered: 'Videos are already registered, so the channel can no longer be changed.',
  correction_limit_reached: 'A channel can be corrected twice per license. Contact support for another change.',
  license_not_active: 'This license is no longer active.',
};

/** Bio-code verification (PLAN F4): the buyer puts a code in the channel description and we look for it. It proves control; it does not decide clearance. */
export default async function ChannelPage({ params, searchParams }: { params: Promise<{ id: string; channelId: string }>; searchParams: Promise<{ result?: string; error?: string }> }) {
  const { id, channelId } = await params;
  const { result, error } = await searchParams;
  const session = await requireBuyerSession(`/licenses/${id}/channels/${channelId}`);
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(channelId).success) notFound();
  const db = getDb();
  const actor = await resolveBuyerActor(db, session.userId, id);
  const view = actor ? await getBioChallenge(db, actor, channelId) : null;
  if (!view || view.channel.licenseId !== id) notFound();
  const { channel, code, autoCheck } = view;
  const platform = PLATFORM_LABELS[channel.platform] ?? channel.platform;
  const verified = channel.verificationStatus === 'verified';
  const outcome = result ? RESULTS[result] : undefined;

  return (
    <Page>
      <PageHeader title={`Verify your ${platform} channel`}>
        <span className="break-all">{channel.handleOrUrl}</span>
      </PageHeader>
      {outcome && (
        <Notice tone={outcome.tone} role="status">
          {outcome.text}
        </Notice>
      )}
      {error && (
        <Notice tone="attention" role="alert">
          {ERRORS[error] ?? 'Something went wrong.'}
        </Notice>
      )}

      {verified ? (
        <Notice tone="ok">This channel is verified. You can remove the code from its description.</Notice>
      ) : code ? (
        <section className="space-y-4 rounded-lg border bg-card p-5">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Copy the code.</li>
            <li>Paste it anywhere in the channel&apos;s description (the About section) and save.</li>
            <li>{autoCheck ? 'Check it here. We read the public description.' : 'Our team looks for it and confirms the channel.'}</li>
          </ol>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background px-4 py-3">
            <code className="font-mono text-[22px] font-medium tracking-wide text-foreground">{code}</code>
            <CopyButton value={code} label="Copy code" />
          </div>
          {autoCheck && (
            <form action={checkVerifyAction.bind(null, id, channelId)}>
              <Button type="submit">Check now</Button>
            </form>
          )}
          <p className="text-[13px] text-muted-foreground">Verifying shows that you control the channel. It does not change what the rights holder has or has not cleared.</p>
        </section>
      ) : (
        <section className="space-y-3 rounded-lg border bg-card p-5">
          <p className="text-sm text-muted-foreground">We give you a short code to put in the channel description. That shows you control the channel.</p>
          <form action={startVerifyAction.bind(null, id, channelId)}>
            <Button type="submit">Get my code</Button>
          </form>
        </section>
      )}

      {!verified && (
        <details className="rounded-lg border bg-card px-5 py-3 text-sm">
          <summary className="cursor-pointer font-semibold text-muted-foreground hover:text-foreground">Typed the wrong channel?</summary>
          <form action={replaceChannelAction.bind(null, id, channelId)} className="mt-3 flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-[13px] font-semibold text-muted-foreground">
              Platform
              <select name="platform" defaultValue={channel.platform} className={`${selectClass} w-40`}>
                {Object.entries(PLATFORM_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid min-w-0 flex-1 gap-1 text-[13px] font-semibold text-muted-foreground">
              Handle or channel link
              <input name="handleOrUrl" required maxLength={300} autoComplete="off" defaultValue={channel.handleOrUrl} className={selectClass} />
            </label>
            <Button type="submit" variant="secondary">
              Correct channel
            </Button>
          </form>
          <p className="mt-2 text-[13px] text-muted-foreground">Only possible before any video is registered, and twice per license.</p>
        </details>
      )}

      <Link href={`/licenses/${id}#channels`} className="inline-block text-sm font-semibold text-muted-foreground hover:text-foreground">
        ← Back to the license
      </Link>
    </Page>
  );
}

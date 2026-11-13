import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Notice, Page, PageHeader, selectClass } from "@/app/seller/ui";
import { requireBuyerSession } from "@/app/buyer-session";
import { DocRow, docActionClass } from "@/components/store/doc-row";
import { PLATFORM_LABELS, istDate, own } from "@/components/store/format";
import { buttonVariants } from "@/components/ui/button";
import { StatusLabel, type StatusTone } from "@/components/ui/status";
import { CLEARANCE_NOTICE, TIER_LABELS } from "@/lib/certificates";
import { verifyUrl } from "@/lib/certificates/server";
import { listBuyerClearance } from "@/lib/clearance/server";
import {
  getCreditNoteByOrder,
  getInvoiceByOrder,
} from "@/lib/invoicing/server";
import {
  getLicenseForBuyer,
  MAX_VIDEO_URLS,
  resolveBuyerActor,
  type Tier,
} from "@/lib/licensing/server";
import { getDb } from "@/lib/platform/db";
import { downloadAction } from "../actions";
import {
  addChannelAction,
  addVideoUrlAction,
  registerVideoAction,
} from "./usage-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "License | MRM",
  robots: { index: false },
};

const videoCapMessage = (cap: number) =>
  `All ${cap} ${cap === 1 ? "video" : "videos"} this license covers ${cap === 1 ? "is" : "are"} registered. Covering more videos needs another license for this track.`;

const ERRORS: Record<string, string> = {
  download_limit_reached:
    "You have used all 20 downloads for this license. Contact support for more.",
  license_not_active: "This license is no longer active.",
  file_unavailable: "That file is not available.",
  invalid_channel: "Enter the channel's handle or link.",
  platform_not_allowed: "That platform is not covered by this license.",
  duplicate_channel: "That channel is already on this license.",
  channel_cap_reached: "This license covers no more channels.",
  invalid_video: "Give the video a name and at least one link starting with https://.",
  invalid_url: "Enter a link that starts with https://.",
  too_many_urls: `A video can carry up to ${MAX_VIDEO_URLS} links.`,
  video_not_found: "That video is not on this license.",
};
const DONE: Record<string, string> = {
  channel_added: "Channel added. Verify it to show you control it.",
  channel_corrected: "Channel corrected.",
  video_registered: "Video registered. Where the track needs the rights holder's release, we have asked for it.",
  url_added: "Link added.",
};
const CLEARANCE: Record<string, { tone: StatusTone; label: string }> = {
  pending: { tone: "attention", label: "Clearance requested" },
  sent: { tone: "attention", label: "Clearance requested" },
  overdue: { tone: "attention", label: "Awaiting rights holder" },
  escalated: { tone: "attention", label: "Awaiting rights holder" },
  completed: { tone: "ok", label: "Cleared" },
  failed: { tone: "blocked", label: "Not cleared" },
};
const clearanceLabel = (status?: string) => (status ? CLEARANCE[status] : undefined);
const STATUS: Record<string, { tone: StatusTone; label: string }> = {
  active: { tone: "ok", label: "Active" },
  expired: { tone: "muted", label: "Expired" },
  revoked: { tone: "blocked", label: "Revoked" },
};
const CHANNEL: Record<string, { tone: StatusTone; label: string }> = {
  verified: { tone: "ok", label: "Verified" },
  pending: { tone: "attention", label: "Check pending" },
  unverified: { tone: "muted", label: "Not verified" },
};

const Section = ({
  id,
  title,
  aside,
  children,
}: {
  id?: string;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <section id={id} className="scroll-mt-20 space-y-3 border-t pt-5">
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-title">{title}</h2>
      {aside}
    </div>
    {children}
  </section>
);

/** Buyer license page (PLAN §5.2 step 6): documents, clean files, channels and videos. Clearance is shown as a process, never a promise. */
export default async function LicensePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; done?: string }>;
}) {
  const { id } = await params;
  const { error, done } = await searchParams;
  const session = await requireBuyerSession(`/licenses/${id}`);
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  const actor = await resolveBuyerActor(db, session.userId, id);
  const view = actor ? await getLicenseForBuyer(db, actor, id) : null;
  if (!view) notFound();
  const l = view.license;
  const [invoice, creditNote, clearance] = await Promise.all([
    getInvoiceByOrder(db, l.orderId),
    getCreditNoteByOrder(db, l.orderId),
    listBuyerClearance(db, actor!, id),
  ]);
  const status = STATUS[l.effectiveStatus]!;
  const active = l.effectiveStatus === "active";
  const videoCapReached =
    view.caps.videoCap !== null && view.videos.length >= view.caps.videoCap;

  return (
    <Page width="wide">
      <div className="max-w-2xl space-y-5">
        <PageHeader
          title={
            <>
              {l.trackTitle}
              <StatusLabel tone={status.tone}>{status.label}</StatusLabel>
            </>
          }
        >
          {l.primaryArtist} · {TIER_LABELS[l.tier as Tier]}
          {l.clientName ? ` · for ${l.clientName}` : ""}
        </PageHeader>
        <p className="font-mono text-[13px] font-normal text-fg-2">
          {l.publicId} ·{" "}
          {l.endsAt
            ? `${istDate(l.startsAt)} to ${istDate(l.endsAt)}`
            : `perpetual from ${istDate(l.startsAt)}`}
        </p>
        {error && (
          <Notice tone="attention" role="alert">
            {error === "video_cap_reached" && view.caps.videoCap !== null
              ? videoCapMessage(view.caps.videoCap)
              : (own(ERRORS, error) ?? "Something went wrong.")}
          </Notice>
        )}
        {own(DONE, done) && (
          <Notice tone="ok" role="status">
            {own(DONE, done)}
          </Notice>
        )}

        <Section title="Documents">
          <ul className="grid gap-2">
            <DocRow
              name="Certificate"
              note="PDF, with the QR code to the public verify page"
              action={
                <a
                  className={docActionClass}
                  href={`/licenses/${l.id}/documents/certificate`}
                >
                  Download
                </a>
              }
            />
            <DocRow
              name={invoice ? `Tax invoice ${invoice.number}` : "Tax invoice"}
              note={invoice ? istDate(invoice.issuedAt) : "Being prepared"}
              action={
                invoice?.pdfKey ? (
                  <a
                    className={docActionClass}
                    href={`/licenses/${l.id}/documents/invoice`}
                  >
                    Download
                  </a>
                ) : undefined
              }
            />
            {creditNote && (
              <DocRow
                name={`Credit note ${creditNote.number}`}
                note={`${istDate(creditNote.issuedAt)}, reverses the invoice in full`}
                action={
                  creditNote.pdfKey ? (
                    <a
                      className={docActionClass}
                      href={`/licenses/${l.id}/documents/credit-note`}
                    >
                      Download
                    </a>
                  ) : undefined
                }
              />
            )}
            <DocRow
              name="Dispute kit"
              note="The certificate summary and license text to send a platform if a claim appears"
              action={
                <a
                  className={docActionClass}
                  href={`/licenses/${l.id}/documents/dispute-kit`}
                >
                  Download
                </a>
              }
            />
            <DocRow
              name="Public verify page"
              note="Anyone can check this license with its ID"
              action={
                <a className={docActionClass} href={verifyUrl(l.publicId)}>
                  Open
                </a>
              }
            />
          </ul>
        </Section>

        <Section
          title="Clean files"
          aside={
            <span className="font-mono text-[13px] font-normal text-fg-2">
              {view.downloadsUsed} of {view.downloadsCap} downloads used
            </span>
          }
        >
          <ul className="grid gap-2">
            {(
              [
                ["master", "Master", "Full-quality file, no watermark"],
                ["mp3", "MP3 320", "No watermark"],
              ] as const
            ).map(([file, name, note]) => (
              <DocRow
                key={file}
                name={name}
                note={note}
                action={
                  <form action={downloadAction.bind(null, l.id, file)}>
                    <button className={docActionClass} disabled={!active}>
                      Download
                    </button>
                  </form>
                }
              />
            ))}
          </ul>
          <p className="text-[13px] text-muted-foreground">
            {active
              ? "Each link works for 15 minutes and counts as one download."
              : "Downloads are off because this license is not active."}
          </p>
        </Section>

        <Section
          id="channels"
          title="Channels"
          aside={
            <span className="font-mono text-[13px] font-normal text-fg-2">
              {view.channels.length} of {view.caps.maxChannels}
            </span>
          }
        >
          {view.channels.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No channels on this license.
            </p>
          ) : (
            <ul className="grid gap-2">
              {view.channels.map((c) => {
                const s = CHANNEL[c.verificationStatus] ?? CHANNEL.unverified!;
                const cl = clearanceLabel(clearance.find((x) => x.channelId === c.id)?.status);
                return (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-md border bg-card px-3.5 py-2.5"
                  >
                    <span className="min-w-0 text-sm">
                      <span className="font-semibold">
                        {PLATFORM_LABELS[c.platform] ?? c.platform}
                      </span>{" "}
                      <span className="break-all text-muted-foreground">
                        {c.handleOrUrl}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <StatusLabel tone={s.tone}>{s.label}</StatusLabel>
                      {cl && <StatusLabel tone={cl.tone}>{cl.label}</StatusLabel>}
                      {c.verificationStatus !== "verified" && (
                        <Link
                          href={`/licenses/${l.id}/channels/${c.id}`}
                          className={docActionClass}
                        >
                          Verify
                        </Link>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {active && view.channels.length < view.caps.maxChannels ? (
            <form
              action={addChannelAction.bind(null, l.id)}
              className="flex flex-wrap items-end gap-2"
            >
              <label className="grid gap-1 text-[13px] font-semibold text-muted-foreground">
                Platform
                <select name="platform" className={`${selectClass} w-40`}>
                  {view.caps.allowedPlatforms.map((p) => (
                    <option key={p} value={p}>
                      {PLATFORM_LABELS[p] ?? p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid min-w-0 flex-1 gap-1 text-[13px] font-semibold text-muted-foreground">
                Handle or channel link
                <input
                  name="handleOrUrl"
                  required
                  maxLength={300}
                  autoComplete="off"
                  placeholder="@yourchannel"
                  className={selectClass}
                />
              </label>
              <button className={buttonVariants({ variant: "secondary" })}>
                Add channel
              </button>
            </form>
          ) : (
            active && (
              <p className="text-[13px] text-muted-foreground">
                This license covers {view.caps.maxChannels}{" "}
                {view.caps.maxChannels === 1 ? "channel" : "channels"}, and{" "}
                {view.caps.maxChannels === 1 ? "it is" : "all are"} in use.
              </p>
            )
          )}
        </Section>

        <Section
          id="videos"
          title="Registered videos"
          aside={
            <span className="font-mono text-[13px] font-normal text-fg-2">
              {view.caps.videoCap === null
                ? `${view.videos.length} registered`
                : `${view.videos.length} of ${view.caps.videoCap}`}
            </span>
          }
        >
          {view.videos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              None yet. Upload privately first, register the video, then publish
              once clearance is complete.
            </p>
          ) : (
            <ul className="grid gap-2">
              {view.videos.map((v) => {
                const cl = clearanceLabel(clearance.find((x) => x.videoId === v.id)?.status);
                return (
                  <li
                    key={v.id}
                    className="space-y-1.5 rounded-md border bg-card px-3.5 py-2.5 text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <p className="font-semibold">{v.label}</p>
                      {cl && <StatusLabel tone={cl.tone}>{cl.label}</StatusLabel>}
                    </div>
                    <ul className="space-y-0.5 text-[13px] text-muted-foreground">
                      {v.urls.map((u) => (
                        <li key={u} className="break-all">
                          {u}
                        </li>
                      ))}
                    </ul>
                    {active && v.urls.length < MAX_VIDEO_URLS && (
                      <details className="text-[13px]">
                        <summary className="cursor-pointer font-semibold text-muted-foreground hover:text-foreground">
                          Add another link
                        </summary>
                        <form
                          action={addVideoUrlAction.bind(null, l.id, v.id)}
                          className="mt-2 flex flex-wrap items-center gap-2"
                        >
                          <input
                            name="url"
                            type="url"
                            required
                            aria-label={`Another link for ${v.label}`}
                            placeholder="https://"
                            className={`${selectClass} min-w-0 flex-1`}
                          />
                          <button className={buttonVariants({ variant: "secondary" })}>
                            Add link
                          </button>
                        </form>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {!active ? null : videoCapReached ? (
            <Notice tone="blocked">{videoCapMessage(view.caps.videoCap!)}</Notice>
          ) : (
            <form
              action={registerVideoAction.bind(null, l.id)}
              className="grid gap-2"
            >
              <label className="grid gap-1 text-[13px] font-semibold text-muted-foreground">
                Video name
                <input
                  name="label"
                  required
                  maxLength={200}
                  autoComplete="off"
                  placeholder="Spring launch, 30 s"
                  className={selectClass}
                />
              </label>
              <label className="grid gap-1 text-[13px] font-semibold text-muted-foreground">
                Links, one per line (up to {MAX_VIDEO_URLS})
                <textarea
                  name="urls"
                  required
                  rows={2}
                  placeholder="https://"
                  className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm font-normal text-foreground outline-none focus-visible:border-ring"
                />
              </label>
              <div>
                <button className={buttonVariants({ variant: "secondary" })}>
                  Register video
                </button>
              </div>
            </form>
          )}
        </Section>

        <Section title="Claims and strikes">
          <p className="text-sm text-muted-foreground">
            If a platform claims, mutes or strikes one of your videos, report it
            here. We record a first action within one business day. The platform
            decides the outcome on its own clock.
          </p>
          <Link
            href={`/licenses/${l.id}/disputes`}
            className={buttonVariants({ variant: "secondary" })}
          >
            Report or follow a claim
          </Link>
        </Section>

        <Section title="Record">
          <dl className="grid gap-1 text-[13px]">
            <div className="flex flex-wrap gap-x-3">
              <dt className="text-muted-foreground">Record hash</dt>
              <dd className="font-mono font-normal break-all">
                {l.recordHash}
              </dd>
            </div>
            <div className="flex flex-wrap gap-x-3">
              <dt className="text-muted-foreground">Integrity</dt>
              <dd>
                {l.recordIntact
                  ? "Record intact"
                  : "Does not match the stored record. Contact support."}
              </dd>
            </div>
          </dl>
        </Section>

        <p className="rounded-md border bg-card px-3.5 py-3 text-sm text-fg-2">
          {CLEARANCE_NOTICE}
        </p>
        <Link
          href="/licenses"
          className="inline-block text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          ← All licenses
        </Link>
      </div>
    </Page>
  );
}

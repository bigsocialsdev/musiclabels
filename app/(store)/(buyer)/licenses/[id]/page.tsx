import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Notice, Page, PageHeader } from "@/app/seller/ui";
import { requireBuyerSession } from "@/app/buyer-session";
import { DocRow, docActionClass } from "@/components/store/doc-row";
import { istDate } from "@/components/store/format";
import { StatusLabel, type StatusTone } from "@/components/ui/status";
import { CLEARANCE_NOTICE, TIER_LABELS } from "@/lib/certificates";
import { verifyUrl } from "@/lib/certificates/server";
import {
  getCreditNoteByOrder,
  getInvoiceByOrder,
} from "@/lib/invoicing/server";
import {
  getLicenseForBuyer,
  resolveBuyerActor,
  type Tier,
} from "@/lib/licensing/server";
import { getDb } from "@/lib/platform/db";
import { downloadAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "License | MRM",
  robots: { index: false },
};

const ERRORS: Record<string, string> = {
  download_limit_reached:
    "You have used all 20 downloads for this license. Contact support for more.",
  license_not_active:
    "Downloads are disabled because this license is no longer active.",
  file_unavailable: "That file is not available.",
};
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

const PLATFORMS: Record<string, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  facebook: "Facebook",
};

const Section = ({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <section className="space-y-3 border-t pt-5">
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
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const session = await requireBuyerSession(`/licenses/${id}`);
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  const actor = await resolveBuyerActor(db, session.userId, id);
  const view = actor ? await getLicenseForBuyer(db, actor, id) : null;
  if (!view) notFound();
  const l = view.license;
  const [invoice, creditNote] = await Promise.all([
    getInvoiceByOrder(db, l.orderId),
    getCreditNoteByOrder(db, l.orderId),
  ]);
  const status = STATUS[l.effectiveStatus]!;
  const active = l.effectiveStatus === "active";

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
            {ERRORS[error] ?? "Something went wrong."}
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

        <Section title="Channels">
          {view.channels.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No channels on this license.
            </p>
          ) : (
            <ul className="grid gap-2">
              {view.channels.map((c) => {
                const s = CHANNEL[c.verificationStatus] ?? CHANNEL.unverified!;
                return (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-3 rounded-md border bg-card px-3.5 py-2.5"
                  >
                    <span className="min-w-0 text-sm">
                      <span className="font-semibold">
                        {PLATFORMS[c.platform] ?? c.platform}
                      </span>{" "}
                      <span className="break-all text-muted-foreground">
                        {c.handleOrUrl}
                      </span>
                    </span>
                    <StatusLabel tone={s.tone}>{s.label}</StatusLabel>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="Registered videos">
          {view.videos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              None yet. Upload privately first, register the video, then publish
              once clearance is complete.
            </p>
          ) : (
            <ul className="grid gap-2">
              {view.videos.map((v) => (
                <li
                  key={v.id}
                  className="rounded-md border bg-card px-3.5 py-2.5 text-sm"
                >
                  <p className="font-semibold">{v.label}</p>
                  <p className="break-all text-[13px] text-muted-foreground">
                    {v.urls.join(", ")}
                  </p>
                </li>
              ))}
            </ul>
          )}
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

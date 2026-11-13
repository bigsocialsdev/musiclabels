import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { DOC_TYPES } from '@/lib/catalog';
import { getOwnTrack, listTaxonomy } from '@/lib/catalog/server';
import { getDb } from '@/lib/platform/db';
import { UploadForm } from '../../upload-form';
import { requireSellerSession } from '../../session';
import {
  confirmAudioUploadAction,
  confirmDocumentUploadAction,
  delistTrackAction,
  editTrackAction,
  requestAudioUploadAction,
  requestDocumentUploadAction,
  saveDeclarationAction,
  submitTrackAction,
  updateTrackAction,
} from '../actions';
import { REGISTRATION_ROWS } from '../form-fields';
import { STATUS_LABELS, statusVariant } from '../status';
import { TrackForm } from '../track-form';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // the audio check runs after the upload is confirmed (a cron sweep reruns it if cut short)

const DOC_LABELS: Record<(typeof DOC_TYPES)[number], string> = {
  pro_registration: 'PRO registration (IPRS, PPL…)',
  distribution_agreement: 'Distribution agreement',
  publishing_agreement: 'Publishing agreement',
  self_declaration: 'Signed self-declaration',
  other: 'Other proof of rights',
};
const DOC_OPTIONS = DOC_TYPES.map((t) => [t, DOC_LABELS[t]] as const);
const WARRANTIES = [
  ['masterControlled', 'I control the master recording'],
  ['compositionControlled', 'I control the composition (music and lyrics)'],
  ['coOwnerConsentWarranted', 'Every co-owner has agreed to this licensing'],
  ['sampleFreeWarranted', 'It contains no uncleared samples'],
  ['notACoverWarranted', 'It is not a cover of someone else’s song'],
] as const;
const SYSTEMS = [
  ['', 'None'],
  ['youtube_cid', 'YouTube Content ID'],
  ['meta_rm', 'Meta Rights Manager'],
  ['other', 'Other'],
] as const;
const selectClass = 'h-9 rounded-md border bg-transparent px-3 text-sm';
const checkState = (s: string) => (s === 'valid' ? 'accepted' : s);
const ingestLabel: Record<string, string> = { pending: 'waiting', processing: 'processing', ready: 'ready', failed: 'failed' };

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

function TrackAction({ action, trackId, label, variant }: { action: (f: FormData) => Promise<void>; trackId: string; label: string; variant?: 'outline' | 'destructive' }) {
  return (
    <form action={action}>
      <input type="hidden" name="trackId" value={trackId} />
      <Button type="submit" variant={variant}>
        {label}
      </Button>
    </form>
  );
}

export default async function SellerTrackPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; done?: string }> }) {
  const { id } = await params;
  const { error, done } = await searchParams;
  const { session, orgId } = await requireSellerSession(`/seller/tracks/${id}`);
  if (!orgId) redirect('/seller/onboarding');
  const db = getDb();
  const detail = /^[0-9a-f-]{36}$/.test(id) ? await getOwnTrack(db, { userId: session.userId, orgId }, id) : null;
  if (!detail) notFound(); // another org's track looks exactly like a missing one
  const { track, declaration, documents, versions, rejection } = detail;
  const draft = track.status === 'draft';
  const taxonomy = draft ? await listTaxonomy(db) : { genres: [], moods: [] };
  const regs = (Array.isArray(declaration?.registrations) ? declaration.registrations : []) as { system: string; administeredBy: string; sellerControlsRelease: boolean }[];

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6">
      <Link href="/seller/tracks" className="text-sm underline">
        All tracks
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{track.title}</h1>
        <Badge variant={statusVariant(track.status)}>{STATUS_LABELS[track.status]}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{track.primaryArtist}</p>
      {error && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-800">
          {done}
        </p>
      )}

      {rejection && (
        <Section title="Changes needed" description="Our review team could not publish this track yet.">
          <p className="whitespace-pre-wrap text-sm">{rejection.reason ?? 'No reason was recorded.'}</p>
          {track.clearanceClass === 'C' ? (
            <p className="text-sm text-muted-foreground">This track cannot be cleared for licensing, so it cannot be sent again.</p>
          ) : (
            <TrackAction action={editTrackAction} trackId={track.id} label="Edit and resubmit" />
          )}
        </Section>
      )}
      {(track.status === 'submitted' || track.status === 'in_review') && <p className="text-sm text-muted-foreground">Your track is with our review team. You will get an email when there is a decision.</p>}
      {track.status === 'suspended' && <p className="text-sm text-muted-foreground">This track is suspended and cannot be bought. Contact support if you think this is a mistake.</p>}
      {track.status === 'delisted' && <p className="text-sm text-muted-foreground">This track is delisted. Licenses already sold stay valid.</p>}

      {draft && (
        <Section title="Details">
          <TrackForm action={updateTrackAction} taxonomy={taxonomy} trackId={track.id} submitLabel="Save details" defaults={track} />
        </Section>
      )}

      <Section title="Audio" description={draft ? 'WAV or MP3. Uploading again adds a new version; the latest one is reviewed.' : undefined}>
        {versions.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {versions.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2">
                Version {v.versionNo}
                <Badge variant={v.ingestStatus === 'ready' ? 'default' : v.ingestStatus === 'failed' ? 'destructive' : 'outline'}>{ingestLabel[v.ingestStatus] ?? v.ingestStatus}</Badge>
                {v.ingestError && <span className="text-muted-foreground">{v.ingestError}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No audio uploaded yet.</p>
        )}
        {draft && (
          <UploadForm
            bucket="masters"
            accept=".wav,.mp3,audio/wav,audio/mpeg"
            fileLabel="Audio file (WAV or MP3, up to 200 MB)"
            request={requestAudioUploadAction.bind(null, track.id)}
            confirm={confirmAudioUploadAction.bind(null, track.id)}
          />
        )}
      </Section>

      <Section title="Rights" description={draft ? 'Confirm what you own, and tell us where the track is already registered.' : undefined}>
        {draft ? (
          <form action={saveDeclarationAction} className="space-y-3">
            <input type="hidden" name="trackId" value={track.id} />
            {WARRANTIES.map(([name, label]) => (
              <label key={name} className="flex items-start gap-2 text-sm">
                <input type="checkbox" name={name} defaultChecked={declaration?.[name] ?? false} className="mt-1" />
                <span>{label}</span>
              </label>
            ))}
            <p className="text-sm font-medium">Already registered somewhere?</p>
            {Array.from({ length: REGISTRATION_ROWS }, (_, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[10rem_1fr_auto] sm:items-center">
                <select name={`reg${i}System`} defaultValue={regs[i]?.system ?? ''} aria-label="Registration system" className={selectClass}>
                  {SYSTEMS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <Input name={`reg${i}By`} placeholder="Administered by (distributor, label…)" defaultValue={regs[i]?.administeredBy ?? ''} />
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" name={`reg${i}Release`} defaultChecked={regs[i]?.sellerControlsRelease ?? false} />I can release claims
                </label>
              </div>
            ))}
            <Button type="submit">Save rights declaration</Button>
          </form>
        ) : declaration ? (
          <p className="text-sm text-muted-foreground">Declared on {declaration.declaredAt.toLocaleDateString('en-IN')}.</p>
        ) : null}

        <h3 className="pt-2 text-sm font-medium">Rights documents</h3>
        {documents.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2">
                {DOC_LABELS[d.docType] ?? d.docType}
                <Badge variant={d.status === 'valid' ? 'default' : d.status === 'rejected' ? 'destructive' : 'outline'}>{checkState(d.status)}</Badge>
                {d.error && <span className="text-muted-foreground">{d.error}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>
        )}
        {draft && (
          <UploadForm
            bucket="documents"
            accept="application/pdf,image/jpeg,image/png"
            fileLabel="File (PDF, JPG or PNG, up to 10 MB)"
            choice={{ label: 'What is it?', options: DOC_OPTIONS }}
            request={requestDocumentUploadAction.bind(null, track.id)}
            confirm={confirmDocumentUploadAction.bind(null, track.id)}
          />
        )}
      </Section>

      {draft && (
        <Section title="Submit for review" description="We check the audio, your rights declaration and documents. Class and price are set by our team.">
          <TrackAction action={submitTrackAction} trackId={track.id} label="Submit for review" />
        </Section>
      )}

      {(track.status === 'published' || track.status === 'suspended') && (
        <Section title="Take off sale" description="Buyers can no longer purchase it. Licenses already sold are not affected.">
          <TrackAction action={delistTrackAction} trackId={track.id} label="Delist this track" variant="destructive" />
        </Section>
      )}
    </main>
  );
}

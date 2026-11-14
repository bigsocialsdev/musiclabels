import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { StatusLabel } from '@/components/ui/status';
import { getCurrentDocument } from '@/lib/legal/server';
import { getDb } from '@/lib/platform/db';
import { ENTITY_TYPES, getOnboardingStatus, getPayoutAccount, getSellerProfile, listSellerDocuments, type OnboardingStatus } from '@/lib/sellers/server';
import { requireSellerSession } from '../session';
import { FlashBanner } from '../flash';
import { Field, Notice, Page, PageHeader, selectClass } from '../ui';
import { UploadForm } from '../upload-form';
import { acceptTermsAction, confirmKycDocumentAction, createSellerAction, requestKycUploadAction, setBankAction, setPanAction, updateProfileAction } from './actions';

export const dynamic = 'force-dynamic';

const ENTITY_LABELS: Record<(typeof ENTITY_TYPES)[number], string> = { individual: 'An individual artist', company: 'A company', partnership: 'A partnership firm', llp: 'An LLP' };
const KIND_LABELS: Record<string, string> = { pan_card: 'PAN card', id_proof: 'ID proof', gst_certificate: 'GST certificate', bank_proof: 'Bank proof (cancelled cheque or statement)' };
const KYC_OPTIONS = Object.entries(KIND_LABELS) as [string, string][];

function Step({ title, done, description, children }: { title: string; done: boolean; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          {title}
          <StatusLabel tone={done ? 'ok' : 'muted'}>{done ? 'Done' : 'To do'}</StatusLabel>
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

function EntitySelect({ value }: { value?: string }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="entityType">You sell as</Label>
      <select id="entityType" name="entityType" defaultValue={value ?? 'individual'} className={selectClass}>
        {ENTITY_TYPES.map((t) => (
          <option key={t} value={t}>
            {ENTITY_LABELS[t]}
          </option>
        ))}
      </select>
    </div>
  );
}

function kycBadge(s: OnboardingStatus) {
  if (s.kycStatus === 'verified') return <StatusLabel tone="ok">KYC verified</StatusLabel>;
  if (s.kycStatus === 'rejected') return <StatusLabel tone="blocked">KYC rejected</StatusLabel>;
  return <StatusLabel tone="info">KYC in review</StatusLabel>;
}

export default async function SellerOnboardingPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const { session, orgId } = await requireSellerSession('/seller/onboarding');
  const db = getDb();
  const banner = <FlashBanner token={m} />;

  if (!orgId) {
    return (
      <Page>
        <PageHeader title="Become a seller">Tell us who sells the music. You can add tax and bank details next.</PageHeader>
        {banner}
        <form action={createSellerAction} className="space-y-4 rounded-lg border bg-card p-5">
          <Field id="legalName" label="Legal name (yours, or your company's)" required minLength={2} />
          <Field id="displayName" label="Name shown to buyers" required minLength={2} />
          <EntitySelect />
          <Field id="opsContactEmail" label="Contact email for clearance requests" type="email" required />
          <Field id="opsContactPhone" label="Contact phone (optional)" type="tel" />
          <Field id="gstin" label="GSTIN (only if you are GST registered)" placeholder="27AAPFU0939F1ZV" />
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" name="worldwideRightsWarranted" required className="mt-[3px] size-4" />
            <span>I confirm I hold the rights to license my music worldwide for online use.</span>
          </label>
          <Button type="submit">Create seller account</Button>
        </form>
      </Page>
    );
  }

  const [status, profile, documents, bank, agreement, commitment] = await Promise.all([
    getOnboardingStatus(db, session, orgId),
    getSellerProfile(db, session, orgId),
    listSellerDocuments(db, session, orgId),
    getPayoutAccount(db, orgId),
    getCurrentDocument(db, 'seller_agreement'),
    getCurrentDocument(db, 'release_commitment'),
  ]);
  if (!status || !profile)
    return (
      <Page>
        <p className="text-sm text-muted-foreground">Seller profile not found.</p>
      </Page>
    );
  const mfaHref = `/auth/mfa?${new URLSearchParams({ next: '/seller/onboarding' })}`;
  const needsTotp = session.aal !== 'aal2';
  const totpNote = needsTotp && (
    <Notice tone="attention">
      Changing this needs your authenticator app.{' '}
      <Link className="font-semibold underline underline-offset-4" href={mfaHref}>
        Verify with your authenticator
      </Link>{' '}
      first.
    </Notice>
  );

  return (
    <Page>
      <PageHeader
        title={
          <>
            Seller onboarding
            {kycBadge(status)}
          </>
        }
      />
      {banner}
      {status.kycStatus === 'rejected' && <Notice tone="blocked">We could not verify your details. Update your documents and contact support.</Notice>}

      <Step title="Profile" done={status.profile} description="Clearance requests for your tracks go to the contact email.">
        <form action={updateProfileAction} className="space-y-3">
          <EntitySelect value={profile.entityType} />
          <Field id="opsContactEmail" label="Contact email" type="email" required defaultValue={profile.opsContactEmail ?? ''} />
          <Field id="opsContactPhone" label="Contact phone (optional)" type="tel" defaultValue={profile.opsContactPhone ?? ''} />
          <Field id="gstin" label="GSTIN (if GST registered)" defaultValue={profile.gstin ?? ''} />
          <Button type="submit">Save profile</Button>
        </form>
      </Step>

      <Step title="PAN" done={status.pan} description="Used for tax deducted on your royalties. Stored encrypted; shown masked.">
        {profile.panMasked && <p className="text-sm">Saved: <span className="font-mono">{profile.panMasked}</span></p>}
        {totpNote}
        {!needsTotp && (
          <form action={setPanAction} className="space-y-3">
            <Field id="pan" label={profile.panMasked ? 'Replace PAN' : 'PAN'} placeholder="ABCDE1234F" required pattern="[A-Za-z]{5}[0-9]{4}[A-Za-z]" autoComplete="off" />
            <Button type="submit">Save PAN</Button>
          </form>
        )}
      </Step>

      <Step title="KYC documents" done={status.documents.panCardValid} description="Upload your PAN card (required) and an ID. Only our verification team can open them.">
        {documents.length > 0 && (
          <ul className="divide-y rounded-md border text-sm">
            {documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                {KIND_LABELS[d.kind] ?? d.kind}
                <StatusLabel tone={d.status === 'valid' ? 'ok' : d.status === 'rejected' ? 'blocked' : 'attention'}>{d.status === 'valid' ? 'accepted' : d.status}</StatusLabel>
                {d.error && <span className="text-muted-foreground">{d.error}</span>}
              </li>
            ))}
          </ul>
        )}
        <UploadForm
          bucket="documents"
          accept="application/pdf,image/jpeg,image/png"
          fileLabel="File (PDF, JPG or PNG, up to 10 MB)"
          choice={{ label: 'Document', options: KYC_OPTIONS }}
          request={requestKycUploadAction}
          confirm={confirmKycDocumentAction}
        />
      </Step>

      <Step title="Bank account" done={status.bank !== 'missing'} description="Royalties are paid here once a month. Finance verifies the account before the first payout.">
        {bank && (
          <p className="text-sm">
            <span className="font-mono">{bank.maskedAccount}</span> · {bank.ifsc} · {bank.accountHolderName}{' '}
            <StatusLabel tone={bank.verified ? 'ok' : 'attention'}>{bank.verified ? 'verified' : 'awaiting verification'}</StatusLabel>
          </p>
        )}
        {totpNote}
        {!needsTotp && (
          <form action={setBankAction} className="space-y-3">
            <Field id="accountHolderName" label="Account holder name (as at the bank)" required minLength={2} />
            <Field id="accountNumber" label="Account number" inputMode="numeric" pattern="[0-9]{9,18}" required autoComplete="off" />
            <Field id="ifsc" label="IFSC" placeholder="HDFC0001234" pattern="[A-Za-z]{4}0[A-Za-z0-9]{6}" required />
            <Button type="submit">{bank ? 'Replace bank account' : 'Save bank account'}</Button>
            {bank && <p className="text-xs text-muted-foreground">Changing it pauses payouts until finance verifies the new account.</p>}
          </form>
        )}
      </Step>

      <Step title="Seller agreement" done={status.sellerAgreement} description="You grant the platform a non-exclusive right to sub-license your tracks.">
        {agreement ? (
          <form action={acceptTermsAction} className="space-y-3">
            <details>
              <summary className="cursor-pointer text-sm font-semibold underline underline-offset-4">Read the agreement (version {agreement.version})</summary>
              <pre tabIndex={0} className="mt-2 max-h-72 overflow-auto rounded-md border bg-background p-3 font-sans text-[13px] leading-relaxed whitespace-pre-wrap text-fg-2">{agreement.bodyMarkdown}</pre>
            </details>
            {status.sellerAgreement ? (
              <p className="text-sm">You accepted this version.</p>
            ) : (
              <>
                <input type="hidden" name="kind" value="seller_agreement" />
                <Button type="submit">I accept the seller agreement</Button>
              </>
            )}
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">The agreement has not been published yet.</p>
        )}
      </Step>

      <Step title="Release commitment (Class B tracks)" done={status.releaseCommitment} description="Only needed if you list tracks that may carry claims on other platforms: you commit to release them when a buyer's video is claimed.">
        {commitment ? (
          <form action={acceptTermsAction} className="space-y-3">
            <details>
              <summary className="cursor-pointer text-sm font-semibold underline underline-offset-4">Read the commitment (version {commitment.version})</summary>
              <pre tabIndex={0} className="mt-2 max-h-72 overflow-auto rounded-md border bg-background p-3 font-sans text-[13px] leading-relaxed whitespace-pre-wrap text-fg-2">{commitment.bodyMarkdown}</pre>
            </details>
            {status.releaseCommitment ? (
              <p className="text-sm">You accepted this version.</p>
            ) : (
              <>
                <input type="hidden" name="kind" value="release_commitment" />
                <Button type="submit" variant="outline">I accept the release commitment</Button>
              </>
            )}
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">The commitment has not been published yet.</p>
        )}
      </Step>

      <p className="text-sm text-muted-foreground">
        {status.readyToSubmit ? 'You can submit tracks for review.' : 'Accept the seller agreement to submit tracks. Payouts also need verified KYC and a verified bank account.'}
      </p>
    </Page>
  );
}

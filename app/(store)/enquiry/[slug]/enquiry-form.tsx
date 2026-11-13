'use client';
import Link from 'next/link';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { enquiryAction, type EnquiryState } from './actions';

const MEDIA = [
  { value: 'tv', label: 'Television' },
  { value: 'ott', label: 'OTT / streaming' },
  { value: 'cinema', label: 'Cinema' },
  { value: 'other', label: 'Something else' },
];

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p role="alert" className="text-[13px] text-destructive">
          Please check this field.
        </p>
      ) : (
        hint && <p className="text-[13px] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

export function EnquiryForm({ trackId, slug }: { trackId: string; slug: string }) {
  const [state, action, pending] = useActionState(enquiryAction.bind(null, trackId), { status: 'idle' } as EnquiryState);
  if (state.status === 'sent') {
    return (
      <div role="status" className="rounded-lg border bg-card p-5">
        <p className="text-title">Enquiry sent</p>
        <p className="mt-1.5 text-sm text-muted-foreground">A confirmation is on its way to {state.email}. The team will reply by email.</p>
        <Link href={`/track/${slug}`} className="mt-4 inline-block text-sm font-semibold underline">
          Back to the track
        </Link>
      </div>
    );
  }
  const bad = (f: string) => state.status === 'error' && state.fields.includes(f);
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.status === 'error' && (
        <p role="alert" className="rounded-md border border-destructive/40 px-3.5 py-2.5 text-sm text-destructive">
          {state.message}
        </p>
      )}
      <div className="grid gap-4 min-[600px]:grid-cols-2">
        <Field id="contactName" label="Your name" error={bad('contactName')}>
          <Input id="contactName" name="contactName" required maxLength={200} autoComplete="name" aria-invalid={bad('contactName')} />
        </Field>
        <Field id="contactEmail" label="Email" error={bad('contactEmail')}>
          <Input id="contactEmail" name="contactEmail" type="email" required maxLength={320} autoComplete="email" aria-invalid={bad('contactEmail')} />
        </Field>
        <Field id="contactPhone" label="Phone (optional)" error={bad('contactPhone')}>
          <Input id="contactPhone" name="contactPhone" type="tel" maxLength={40} autoComplete="tel" aria-invalid={bad('contactPhone')} />
        </Field>
        <Field id="media" label="Where will it run?" error={bad('media')}>
          <select id="media" name="media" required defaultValue="tv" className="h-9 rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50">
            {MEDIA.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field id="intendedUse" label="How will you use the track?" hint="Project, territory, run time, and anything else that helps us quote." error={bad('intendedUse')}>
        <Textarea id="intendedUse" name="intendedUse" required minLength={10} maxLength={4000} rows={5} aria-invalid={bad('intendedUse')} />
      </Field>
      <Field id="budgetRange" label="Budget (optional)" error={bad('budgetRange')}>
        <Input id="budgetRange" name="budgetRange" maxLength={100} placeholder="For example ₹1–2 lakh" aria-invalid={bad('budgetRange')} />
      </Field>
      <Button type="submit" size="lg" disabled={pending} className="self-start">
        {pending ? 'Sending…' : 'Send enquiry'}
      </Button>
    </form>
  );
}

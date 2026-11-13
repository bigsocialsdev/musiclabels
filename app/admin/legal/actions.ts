'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { LEGAL_KINDS, publishLegalDocument } from '@/lib/legal/server';
import { getDb } from '@/lib/platform/db';
import { clientIp } from '@/lib/platform/request';
import { requireAdminArea } from '../guard';

const back: (params: Record<string, string>) => never = (params) => redirect(`/admin/legal?${new URLSearchParams(params)}`);

/** An optional "effective from" typed as an IST date and time (`2026-12-01T09:00`): blank means now. */
const effectiveAt = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  .transform((v) => new Date(`${v}:00+05:30`))
  .refine((d) => !Number.isNaN(d.getTime()))
  .optional();

export async function publishLegalAction(form: FormData) {
  const admin = await requireAdminArea('superadmin', '/admin/legal');
  const raw = Object.fromEntries(form);
  const input = z
    .object({ kind: z.enum(LEGAL_KINDS), body: z.string().min(20).max(200_000), effectiveAt: z.preprocess((v) => (v === '' ? undefined : v), effectiveAt), confirm: z.literal('on') })
    .safeParse(raw);
  if (!input.success) back({ error: 'bad_input' });
  const doc = await publishLegalDocument(getDb(), admin, { kind: input.data.kind, bodyMarkdown: input.data.body, effectiveAt: input.data.effectiveAt }, clientIp(await headers()));
  back({ done: 'published', kind: doc.kind, version: String(doc.version) });
}

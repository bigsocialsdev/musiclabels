'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { CatalogError, createTaxonomyItem, reclassifyTrack, setTaxonomyActive, setTrackAvailability } from '@/lib/catalog/server';
import { activatePriceBook, createPriceBook } from '@/lib/pricing/server';
import { getDb } from '@/lib/platform/db';
import { clientIp } from '@/lib/platform/request';
import { requireAdminArea } from '../guard';
import { parsePriceGrid } from './price-grid';

const id = z.uuid();
const reason = z.string().trim().min(1).max(1000);
const go = (path: string): ((params: Record<string, string>) => never) => (params) => redirect(`/admin/catalog${path}?${new URLSearchParams(params)}`);
type Redirect = (params: Record<string, string>) => never; // an annotated type, so TypeScript narrows after a call
const tracksPage: Redirect = go('');
const taxonomyPage: Redirect = go('/taxonomy');
const pricingPage: Redirect = go('/pricing');

export async function availabilityAction(trackId: string, form: FormData) {
  const admin = await requireAdminArea('verification', '/admin/catalog');
  const input = z.object({ action: z.enum(['suspend', 'reinstate', 'delist']), reason }).safeParse(Object.fromEntries(form));
  if (!input.success) tracksPage({ error: 'need_reason' });
  const r = await setTrackAvailability(getDb(), admin, { trackId: id.parse(trackId), ...input.data }, clientIp(await headers()));
  tracksPage(r.ok ? { done: input.data.action } : { error: 'cannot_move' });
}

export async function reclassifyAction(trackId: string, form: FormData) {
  const admin = await requireAdminArea('verification', '/admin/catalog');
  const input = z.object({ to: z.enum(['B', 'C']), reason }).safeParse(Object.fromEntries(form));
  if (!input.success) tracksPage({ error: 'need_reason' });
  let r;
  try {
    r = await reclassifyTrack(getDb(), admin, { trackId: id.parse(trackId), ...input.data }, clientIp(await headers()));
  } catch (e) {
    if (e instanceof CatalogError) tracksPage({ error: 'need_reason' });
    throw e;
  }
  tracksPage(r.ok ? { done: `class_${input.data.to}` } : { error: r.reason });
}

export async function createTaxonomyAction(form: FormData) {
  const admin = await requireAdminArea('verification', '/admin/catalog/taxonomy');
  const input = z.object({ kind: z.enum(['genre', 'mood']), name: z.string().trim().min(1).max(60) }).safeParse(Object.fromEntries(form));
  if (!input.success) taxonomyPage({ error: 'bad_name' });
  const r = await createTaxonomyItem(getDb(), admin, input.data, clientIp(await headers()));
  taxonomyPage(r.ok ? { done: 'created' } : { error: 'exists' });
}

export async function toggleTaxonomyAction(kind: 'genre' | 'mood', itemId: string, active: boolean) {
  const admin = await requireAdminArea('verification', '/admin/catalog/taxonomy');
  const r = await setTaxonomyActive(getDb(), admin, { kind: z.enum(['genre', 'mood']).parse(kind), id: id.parse(itemId), active }, clientIp(await headers()));
  taxonomyPage(r.ok ? { done: active ? 'restored' : 'retired' } : { error: 'changed' });
}

export async function createPriceBookAction(form: FormData) {
  const admin = await requireAdminArea('verification', '/admin/catalog/pricing');
  const grid = parsePriceGrid(Object.fromEntries(form));
  if (!grid) pricingPage({ error: 'bad_grid' });
  const book = await createPriceBook(getDb(), admin, grid, clientIp(await headers()));
  pricingPage({ done: 'created', version: String(book.version) });
}

export async function activatePriceBookAction(bookId: string) {
  const admin = await requireAdminArea('verification', '/admin/catalog/pricing');
  const r = await activatePriceBook(getDb(), admin, id.parse(bookId), clientIp(await headers()));
  pricingPage(r.ok ? { done: 'activated' } : { error: 'not_draft' });
}

import { and, eq, isNull } from 'drizzle-orm';
import { invoiceSeries, invoices } from '@/db/schema';
import { getEnv } from '@/lib/platform/env';
import type { DbOrTx, Tx } from '@/lib/platform/db';
import { BUCKETS, type ObjectStore } from '@/lib/platform/storage';
import { financialYear, formatDocumentNumber, isValidGstin, type GstBreakdown, type SeriesKind } from '../index';
import { renderInvoicePdf } from './invoice-pdf';

export type Invoice = typeof invoices.$inferSelect;

export type BillingConfig = { supplierName: string; supplierAddress: string; supplierGstin: string; supplierStateCode: string; sacCode: string; gstRateBps: number };

/** [CA] values from env, checked at use. The order snapshots them, so an invoice always matches its order. */
export function getBillingConfig(): BillingConfig {
  const env = getEnv();
  if (!env.SUPPLIER_GSTIN || !isValidGstin(env.SUPPLIER_GSTIN)) throw new Error('SUPPLIER_GSTIN is missing or invalid');
  if (!env.SUPPLIER_LEGAL_NAME || !env.SUPPLIER_ADDRESS) throw new Error('SUPPLIER_LEGAL_NAME and SUPPLIER_ADDRESS must be configured');
  if (!env.SAC_CODE) throw new Error('SAC_CODE is not configured');
  if (env.GST_RATE_BPS === undefined) throw new Error('GST_RATE_BPS is not configured');
  const gstin = env.SUPPLIER_GSTIN.toUpperCase();
  return {
    supplierName: env.SUPPLIER_LEGAL_NAME,
    supplierAddress: env.SUPPLIER_ADDRESS,
    supplierGstin: gstin,
    supplierStateCode: gstin.slice(0, 2),
    sacCode: env.SAC_CODE,
    gstRateBps: env.GST_RATE_BPS,
  };
}

/**
 * Next consecutive number of a series for a financial year. Must run inside the transaction that inserts the
 * document: the series row stays locked until it commits, and a rollback returns the number, so there are no
 * gaps and no duplicates under concurrency.
 */
export async function allocateDocumentNumber(tx: Tx, kind: SeriesKind, fy: string): Promise<string> {
  await tx.insert(invoiceSeries).values({ fy, kind }).onConflictDoNothing();
  const [row] = await tx
    .select({ next: invoiceSeries.nextNumber })
    .from(invoiceSeries)
    .where(and(eq(invoiceSeries.fy, fy), eq(invoiceSeries.kind, kind)))
    .for('update');
  await tx
    .update(invoiceSeries)
    .set({ nextNumber: row!.next + 1 })
    .where(and(eq(invoiceSeries.fy, fy), eq(invoiceSeries.kind, kind)));
  return formatDocumentNumber(kind, fy, row!.next);
}

export type IssueInvoiceInput = {
  orderId: string;
  issuedAt: Date;
  supplierName: string;
  supplierAddress: string;
  supplierGstin: string;
  supplierStateCode: string;
  sacCode: string;
  recipientName: string;
  recipientGstin: string | null;
  recipientStateCode: string;
  recipientAddress: string | null;
  lineDescription: string;
  gst: GstBreakdown;
};

/**
 * Issues the tax invoice for an order from its snapshot, inside fulfilment's legal-facts transaction.
 * Idempotent on order_id: a re-run returns the existing invoice and allocates nothing.
 */
export async function issueInvoice(tx: Tx, input: IssueInvoiceInput): Promise<{ invoice: Invoice; created: boolean }> {
  const [existing] = await tx.select().from(invoices).where(eq(invoices.orderId, input.orderId));
  if (existing) return { invoice: existing, created: false };
  const fy = financialYear(input.issuedAt);
  const [invoice] = await tx
    .insert(invoices)
    .values({
      orderId: input.orderId,
      number: await allocateDocumentNumber(tx, 'invoice', fy),
      fy,
      issuedAt: input.issuedAt,
      supplierName: input.supplierName,
      supplierAddress: input.supplierAddress,
      supplierGstin: input.supplierGstin,
      supplierStateCode: input.supplierStateCode,
      recipientName: input.recipientName,
      recipientGstin: input.recipientGstin,
      recipientStateCode: input.recipientStateCode,
      recipientAddress: input.recipientAddress,
      placeOfSupplyState: input.gst.placeOfSupplyState,
      sacCode: input.sacCode,
      gstRateBps: input.gst.gstRateBps,
      taxablePaise: input.gst.taxablePaise,
      cgstPaise: input.gst.cgstPaise,
      sgstPaise: input.gst.sgstPaise,
      igstPaise: input.gst.igstPaise,
      totalPaise: input.gst.totalPaise,
      lineDescription: input.lineDescription,
    })
    .returning();
  return { invoice: invoice!, created: true };
}

export async function getInvoiceByOrder(db: DbOrTx, orderId: string): Promise<Invoice | null> {
  const [row] = await db.select().from(invoices).where(eq(invoices.orderId, orderId));
  return row ?? null;
}

/** Renders and stores the PDF once (pdf_key is write-once). Re-renderable from the row; safe to re-run. */
export async function storeInvoicePdf(db: DbOrTx, invoiceId: string, store: ObjectStore): Promise<string> {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv) throw new Error('invoice not found');
  if (inv.pdfKey) return inv.pdfKey;
  const key = `invoices/${inv.fy}/${inv.number.replaceAll('/', '-')}.pdf`;
  await store.upload(BUCKETS.pdfs, key, await renderInvoicePdf(inv), 'application/pdf');
  await db.update(invoices).set({ pdfKey: key }).where(and(eq(invoices.id, invoiceId), isNull(invoices.pdfKey)));
  return key;
}

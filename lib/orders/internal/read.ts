import { eq } from 'drizzle-orm';
import { orders } from '@/db/schema';
import { getMembershipRole } from '@/lib/identity/server';
import { getLicenseByOrder } from '@/lib/licensing/server';
import type { DbOrTx } from '@/lib/platform/db';
import type { OrderSnapshot, OrderStatus } from '../index';

/** The buyer's view of an order (checkout return page): null unless the user is a member of the buying org. */
export async function getOrderForBuyer(db: DbOrTx, userId: string, orderId: string) {
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!o || !(await getMembershipRole(db, userId, o.buyerOrgId))) return null;
  const license = await getLicenseByOrder(db, o.id);
  return {
    id: o.id,
    buyerOrgId: o.buyerOrgId,
    status: o.status as OrderStatus,
    tier: o.tier,
    snapshot: o.snapshot as OrderSnapshot,
    taxablePaise: o.taxablePaise,
    cgstPaise: o.cgstPaise,
    sgstPaise: o.sgstPaise,
    igstPaise: o.igstPaise,
    totalPaise: o.totalPaise,
    expiresAt: o.expiresAt,
    licenseId: license?.id ?? null,
  };
}

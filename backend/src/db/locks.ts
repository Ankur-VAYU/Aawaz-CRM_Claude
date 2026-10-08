import { sql } from 'drizzle-orm';
import type { Db } from './index.js';

/**
 * Serialises every write that changes a shop's stock, khata or invoice numbers. Taking this one
 * lock first, in every such transaction, gives all of them the same lock order, so they queue
 * instead of deadlocking. Held until the transaction ends; writes for other shops are unaffected.
 */
export async function lockStore(tx: Db, storeId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${storeId}::text, 7031))`);
}

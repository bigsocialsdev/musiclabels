import 'server-only';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/db/schema';
import { getEnv } from './env';

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Slice functions take this so they can join the caller's transaction. */
export type DbOrTx = Db | Tx;

const g = globalThis as unknown as { __sql?: postgres.Sql; __db?: Db };

/** Lazy singleton (survives dev HMR). `prepare: false` because the app talks to the transaction-mode pooler. */
export function getDb(): Db {
  if (!g.__db) {
    g.__sql = postgres(getEnv().DATABASE_URL, { prepare: false, max: 5, onnotice: () => {} });
    g.__db = drizzle(g.__sql, { schema });
  }
  return g.__db;
}

export async function closeDb(): Promise<void> {
  await g.__sql?.end();
  g.__sql = undefined;
  g.__db = undefined;
}

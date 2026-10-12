import { Pool, type QueryResult } from 'pg';

/**
 * Lazy pool proxy.
 *
 * `new Pool()` must NOT run at module scope: this module is imported by the
 * Edge-runtime middleware (via auth.ts), and `pg` cannot be instantiated in
 * the Edge runtime. The proxy defers real pool construction until the first
 * actual query/connect. The middleware never touches the DB (the `authorized`
 * callback is pure), so middleware requests stay cheap and never construct
 * a pool.
 */
function lazyPool(getConnectionString: () => string | undefined): Pool {
  let pool: Pool | null = null;
  const get = (): Pool => {
    if (!pool) {
      pool = new Pool({ connectionString: getConnectionString() });
    }
    return pool;
  };
  return new Proxy({} as Pool, {
    get(_target, prop) {
      const value = (get() as unknown as Record<PropertyKey, unknown>)[prop];
      return typeof value === 'function'
        ? (...args: unknown[]) =>
            (value as (...a: unknown[]) => unknown).apply(get(), args)
        : value;
    },
  });
}

/**
 * Connects as the NON-OWNER app_user role so RLS applies.
 * Set DATABASE_URL to the app_user (non-owner) connection string.
 */
export const appPool: Pool = lazyPool(() => process.env.DATABASE_URL);

/**
 * Bypasses RLS; for signup inserts, seed-adjacent ops, and service reads.
 * Falls back to DATABASE_URL when DATABASE_OWNER_URL is not set.
 */
export const ownerPool: Pool = lazyPool(
  () => process.env.DATABASE_OWNER_URL || process.env.DATABASE_URL
);

export type QueryFn = (
  text: string,
  params?: any[]
) => Promise<{ rows: any[]; rowCount: number }>;

/**
 * Run `fn` inside a transaction on appPool with `app.current_user_id` set
 * for the transaction, so RLS policies keyed on that setting apply.
 * Rolls back and releases the client on error.
 */
export async function withUser<T>(
  userId: string,
  fn: (q: QueryFn) => Promise<T>
): Promise<T> {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL app.current_user_id = $1', [userId]);
    const q: QueryFn = (text, params) =>
      client.query(text, params) as Promise<QueryResult<any>> as Promise<{
        rows: any[];
        rowCount: number;
      }>;
    const result = await fn(q);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore rollback errors */
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Service-level queries against the owner connection (bypasses RLS). */
export const db = {
  query: (text: string, params?: any[]) => ownerPool.query(text, params),
};

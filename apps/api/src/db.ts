/**
 * DB access. Every request runs inside a transaction that first executes
 *   select set_config('request.space_id', <uuid>, true)
 * so RLS policies scope by current_space() (0001_init.sql). set_config with
 * is_local=true is transaction-scoped — hence the mandatory BEGIN/COMMIT.
 */
import pg from 'pg';

export interface QueryResultLike {
  rows: Record<string, unknown>[];
  rowCount: number | null;
}

export interface Queryable {
  query(text: string, params?: unknown[]): Promise<QueryResultLike>;
}

export interface Db {
  /** Run fn inside a tx scoped to spaceId (null = studio-global/operator). */
  withSpace<T>(spaceId: string | null, fn: (q: Queryable) => Promise<T>): Promise<T>;
  /** Un-scoped query (auth lookups happen before a space is known). */
  query(text: string, params?: unknown[]): Promise<QueryResultLike>;
  end(): Promise<void>;
}

export function createDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 10 });

  return {
    async withSpace<T>(spaceId: string | null, fn: (q: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query("select set_config('request.space_id', $1, true)", [spaceId ?? '']);
        const result = await fn({
          query: async (text, params) => {
            const r = await client.query(text, params as unknown[] | undefined);
            return { rows: r.rows as Record<string, unknown>[], rowCount: r.rowCount };
          },
        });
        await client.query('commit');
        return result;
      } catch (err) {
        await client.query('rollback').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },

    async query(text, params) {
      const r = await pool.query(text, params as unknown[] | undefined);
      return { rows: r.rows as Record<string, unknown>[], rowCount: r.rowCount };
    },

    async end() {
      await pool.end();
    },
  };
}

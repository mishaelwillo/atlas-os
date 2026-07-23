/** Test doubles: FakeDb (records SQL + space scoping), fake router, test deps. */
import { createHmac } from 'node:crypto';
import type { AtlasRouter } from '@atlas/router';
import type { Db, Queryable, QueryResultLike } from '../db.js';
import { capabilityMetaMap } from '../deps.js';
import { dispatchers } from '../dispatch.js';
import { loadEnv, type Env } from '../env.js';
import { handlers } from '../handlers/index.js';
import type { PipelineDeps } from '../pipeline.js';

export interface RecordedQuery {
  sql: string;
  params: unknown[] | undefined;
  /** space the surrounding withSpace tx was scoped to; 'pool' = un-scoped */
  space: string | null | 'pool';
}

type Rows = Record<string, unknown>[];
type Responder = { re: RegExp; rows: Rows | ((params: unknown[] | undefined) => Rows) };

export class FakeDb implements Db {
  readonly calls: RecordedQuery[] = [];
  readonly spaceLog: Array<string | null> = [];
  private readonly responders: Responder[] = [];

  when(re: RegExp, rows: Rows | ((params: unknown[] | undefined) => Rows)): this {
    this.responders.push({ re, rows });
    return this;
  }

  private exec(sql: string, params: unknown[] | undefined, space: string | null | 'pool'): QueryResultLike {
    this.calls.push({ sql, params, space });
    for (const r of this.responders) {
      if (r.re.test(sql)) {
        const rows = typeof r.rows === 'function' ? r.rows(params) : r.rows;
        return { rows, rowCount: rows.length };
      }
    }
    return { rows: [], rowCount: 0 };
  }

  async withSpace<T>(spaceId: string | null, fn: (q: Queryable) => Promise<T>): Promise<T> {
    this.spaceLog.push(spaceId);
    return fn({ query: async (sql, params) => this.exec(sql, params, spaceId) });
  }

  async query(sql: string, params?: unknown[]): Promise<QueryResultLike> {
    return this.exec(sql, params, 'pool');
  }

  async end(): Promise<void> {
    /* nothing to close */
  }

  auditInserts(): RecordedQuery[] {
    return this.calls.filter((c) => c.sql.includes('insert into audit_log'));
  }
}

export const stubRouter: AtlasRouter = {
  async complete(_taskClass, _messages) {
    return { text: 'stub completion', model: 'stub/model-1', tokensIn: 10, tokensOut: 20, costUsd: 0.001 };
  },
};

export function testEnv(): Env {
  return loadEnv({
    OPERATOR_EMAIL: 'operator@test.local',
    SUPABASE_JWT_SECRET: 'test-jwt-secret',
    DATABASE_URL: 'postgres://unused',
  } as NodeJS.ProcessEnv);
}

export function buildTestDeps(db: FakeDb, env: Env = testEnv()): PipelineDeps {
  return {
    db,
    env,
    router: stubRouter,
    capabilities: capabilityMetaMap(),
    handlers,
    dispatchers,
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
  };
}

const b64url = (b: Buffer): string => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Mint an HS256 JWT the auth layer accepts as the operator. */
export function operatorJwt(env: Env, email = env.operatorEmail, expOffsetSec = 3600): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = b64url(Buffer.from(JSON.stringify({ email, exp: Math.floor(Date.now() / 1000) + expOffsetSec })));
  const sig = b64url(createHmac('sha256', env.supabaseJwtSecret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

/** Register a plaintext api token in the FakeDb (auth.ts hashes with sha256). */
export function registerToken(
  db: FakeDb,
  opts: { spaceId: string; label: string; scopes: string[]; hash: string },
): void {
  db.when(/from api_tokens/, (params) => {
    if (params?.[0] === opts.hash) {
      return [{ token_id: 'tok-1', space_id: opts.spaceId, label: opts.label, scopes: opts.scopes }];
    }
    return [];
  });
}

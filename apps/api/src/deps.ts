/** Builds the production PipelineDeps (tests build their own with fakes). */
import { registry } from '@atlas/registry';
import { OpenRouterProvider, createRouter, type AtlasRouter } from '@atlas/router';
import { createDb, type Db } from './db.js';
import { dispatchers } from './dispatch.js';
import { loadEnv, type Env } from './env.js';
import { loadBuildInfo, type BuildInfo } from './build-info.js';
import { UnconfiguredHosting, type HostingAdapter } from './factory/hosting.js';
import { READ_BACK_ATTEMPTS, READ_BACK_DELAY_MS, READ_BACK_MAX_DELAY_MS } from './factory/fingerprint.js';
import { pagesHostingFromEnv } from './factory/cloudflare-pages.js';
import { handlers } from './handlers/index.js';
import type { CapabilityRouteMeta, PipelineDeps } from './pipeline.js';

export function capabilityMetaMap(): Record<string, CapabilityRouteMeta> {
  const map: Record<string, CapabilityRouteMeta> = {};
  for (const cap of registry) {
    map[cap.id] = {
      id: cap.id,
      name: cap.name,
      path: '/v1/' + cap.id.split('.').join('/'),
      method: cap.method,
      taskClass: cap.taskClass,
      requiresApproval: cap.requiresApproval,
      scopes: cap.scopes,
      input: cap.input,
      output: cap.output,
      execution: cap.execution,
    };
  }
  return map;
}

export interface BuildDepsOptions {
  env?: Env;
  db?: Db;
  router?: AtlasRouter;
  buildInfo?: BuildInfo;
  hosting?: HostingAdapter;
  readPublic?: (url: string) => Promise<{ status: number; body: string }>;
  readBack?: { attempts: number; delayMs: number; maxDelayMs?: number };
  log?: PipelineDeps['log'];
}

export function buildDeps(opts: BuildDepsOptions = {}): PipelineDeps {
  const env = opts.env ?? loadEnv();
  const db = opts.db ?? createDb(env.databaseUrl);
  const router =
    opts.router ??
    createRouter(
      {
        chains: { think: env.chainThink, do: env.chainDo, quick: env.chainQuick },
        timeoutMs: env.modelTimeoutMs,
        concurrency: 2,
      },
      new OpenRouterProvider({ baseUrl: env.modelBaseUrl, apiKey: env.modelApiKey }),
    );

  return {
    db,
    env,
    buildInfo: opts.buildInfo ?? loadBuildInfo(),
    // Falls back to the refusing adapter, so an unconfigured deployment
    // records a queued build rather than claiming an address that does not
    // serve.
    hosting: opts.hosting ?? pagesHostingFromEnv(process.env) ?? new UnconfiguredHosting(),
    /*
     * Follows redirects on purpose: Pages answers a path without its trailing
     * slash with a 308, and the bytes a reader receives are the ones after
     * that redirect. Comparing the redirect body would compare nothing.
     */
    readPublic:
      opts.readPublic ??
      (async (url: string) => {
        const res = await fetch(url, { redirect: 'follow' });
        return { status: res.status, body: await res.text() };
      }),
    readBack:
      opts.readBack ?? {
        attempts: READ_BACK_ATTEMPTS,
        delayMs: READ_BACK_DELAY_MS,
        maxDelayMs: READ_BACK_MAX_DELAY_MS,
      },
    router,
    capabilities: capabilityMetaMap(),
    handlers,
    dispatchers,
    log: opts.log ?? {
      info: (o, m) => console.log(m ?? '', o),
      warn: (o, m) => console.warn(m ?? '', o),
      error: (o, m) => console.error(m ?? '', o),
    },
  };
}

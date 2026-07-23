/** Builds the production PipelineDeps (tests build their own with fakes). */
import { registry } from '@atlas/registry';
import { OpenRouterProvider, createRouter, type AtlasRouter } from '@atlas/router';
import { createDb, type Db } from './db.js';
import { dispatchers } from './dispatch.js';
import { loadEnv, type Env } from './env.js';
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
    };
  }
  return map;
}

export interface BuildDepsOptions {
  env?: Env;
  db?: Db;
  router?: AtlasRouter;
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

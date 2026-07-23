import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { buildDeps, type BuildDepsOptions } from './deps.js';
import type { PipelineDeps } from './pipeline.js';
import { registerGeneratedRoutes } from './routes.gen.js';

dotenv.config();

export interface BuildAppOptions {
  deps?: PipelineDeps;
  depsOptions?: BuildDepsOptions;
}

export function buildApp(opts: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: true });

  const originEnv = process.env.OS_APP_ORIGIN;
  const allowedOrigins = originEnv ? originEnv.split(',') : ['http://localhost:5173', 'http://localhost:3000'];

  app.register(cors, {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  app.get('/healthz', async () => {
    return { ok: true, version: '0.1.0' };
  });

  const deps =
    opts.deps ??
    buildDeps({
      ...opts.depsOptions,
      log: opts.depsOptions?.log ?? {
        info: (o, m) => app.log.info(o, m),
        warn: (o, m) => app.log.warn(o, m),
        error: (o, m) => app.log.error(o, m),
      },
    });

  // Every /v1 route comes from codegen — no hand-wired capability routes.
  registerGeneratedRoutes(app, deps);

  return app;
}

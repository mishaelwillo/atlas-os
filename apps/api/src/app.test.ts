import { describe, it, expect } from 'vitest';
import { buildApp } from './app.js';
import { FakeDb, buildTestDeps, operatorJwt, testEnv } from './test/fakes.js';

describe('API Smoke Tests', () => {
  it('GET /healthz returns the injected deployment fingerprint', async () => {
    const app = buildApp({
      deps: buildTestDeps(new FakeDb()),
      buildInfo: {
        service: 'atlas-api',
        appVersion: '0.1.0',
        gitSha: 'abc123',
        buildTime: '2026-07-24T00:00:00Z',
        schemaVersion: '0001_init',
        registryVersion: 1,
      },
    });
    const response = await app.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      ok: true,
      service: 'atlas-api',
      appVersion: '0.1.0',
      gitSha: 'abc123',
      buildTime: '2026-07-24T00:00:00Z',
      schemaVersion: '0001_init',
      registryVersion: 1,
    });
  });

  it('GET /healthz reports unknown when build identity is unavailable', async () => {
    const keys = ['ATLAS_GIT_SHA', 'RAILWAY_GIT_COMMIT_SHA', 'ATLAS_BUILD_TIME'] as const;
    const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    keys.forEach((key) => delete process.env[key]);

    try {
      const app = buildApp({ deps: buildTestDeps(new FakeDb()) });
      const response = await app.inject({ method: 'GET', url: '/healthz' });
      const body = JSON.parse(response.body) as { gitSha: string; buildTime: string };

      expect(body.gitSha).toBe('unknown');
      expect(body.buildTime).toBe('unknown');
    } finally {
      for (const key of keys) {
        if (original[key] === undefined) delete process.env[key];
        else process.env[key] = original[key];
      }
    }
  });

  it('GET /healthz uses Railway identity when a default Docker build argument is unknown', async () => {
    const originalAtlasSha = process.env.ATLAS_GIT_SHA;
    const originalRailwaySha = process.env.RAILWAY_GIT_COMMIT_SHA;
    process.env.ATLAS_GIT_SHA = 'unknown';
    process.env.RAILWAY_GIT_COMMIT_SHA = 'railway123';

    try {
      const app = buildApp({ deps: buildTestDeps(new FakeDb()) });
      const response = await app.inject({ method: 'GET', url: '/healthz' });
      const body = JSON.parse(response.body) as { gitSha: string };

      expect(body.gitSha).toBe('railway123');
    } finally {
      if (originalAtlasSha === undefined) delete process.env.ATLAS_GIT_SHA;
      else process.env.ATLAS_GIT_SHA = originalAtlasSha;
      if (originalRailwaySha === undefined) delete process.env.RAILWAY_GIT_COMMIT_SHA;
      else process.env.RAILWAY_GIT_COMMIT_SHA = originalRailwaySha;
    }
  });

  it('GET /v1/status/mission_control requires auth (401 anonymous)', async () => {
    const app = buildApp({ deps: buildTestDeps(new FakeDb()) });
    const response = await app.inject({ method: 'GET', url: '/v1/status/mission_control' });
    expect(response.statusCode).toBe(401);
  });

  it('GET /v1/status/mission_control returns declarative cards for the operator', async () => {
    const app = buildApp({ deps: buildTestDeps(new FakeDb()) });
    const jwt = operatorJwt(testEnv());
    const response = await app.inject({
      method: 'GET',
      url: '/v1/status/mission_control',
      headers: { authorization: `Bearer ${jwt}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; cards: Array<{ id: string; kind: string }> };
    expect(body.ok).toBe(true);
    const kinds = body.cards.map((c) => c.kind);
    expect(kinds).toEqual(expect.arrayContaining(['approvals', 'runs', 'model_chain', 'cache', 'schedules']));
  });
});

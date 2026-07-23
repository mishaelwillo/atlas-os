import { describe, it, expect } from 'vitest';
import { buildApp } from './app.js';
import { FakeDb, buildTestDeps, operatorJwt, testEnv } from './test/fakes.js';

describe('API Smoke Tests', () => {
  it('GET /healthz returns ok and version', async () => {
    const app = buildApp({ deps: buildTestDeps(new FakeDb()) });
    const response = await app.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, version: '0.1.0' });
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

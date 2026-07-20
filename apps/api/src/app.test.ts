import { describe, it, expect } from 'vitest';
import { buildApp } from './app.js';

describe('API Smoke Tests', () => {
  it('GET /healthz returns ok and version', async () => {
    const app = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/healthz',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toEqual({ ok: true, version: '0.1.0' });
  });

  it('GET /v1/status/mission_control returns empty cards array', async () => {
    const app = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/status/mission_control',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toEqual({ ok: true, cards: [] });
  });
});

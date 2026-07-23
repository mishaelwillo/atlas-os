import { HealthStatus } from '@atlas/shared';

// Generated per-capability client (codegen from packages/registry/registry.ts)
export * from './client.gen.js';

export interface AtlasClient {
  healthz(): Promise<HealthStatus>;
}

export function createClient(baseUrl: string, token?: string): AtlasClient {
  const cleanUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

  return {
    async healthz(): Promise<HealthStatus> {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${cleanUrl}/healthz`, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch healthz status: ${response.statusText}`);
      }

      return response.json() as Promise<HealthStatus>;
    }
  };
}

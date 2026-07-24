import { describe, expect, it } from 'vitest';
import { loadBuildInfo } from './build-info.js';

describe('loadBuildInfo', () => {
  it('loads an explicit API deployment fingerprint', () => {
    expect(
      loadBuildInfo({
        ATLAS_GIT_SHA: 'abc123',
        ATLAS_BUILD_TIME: '2026-07-24T00:00:00Z',
        ATLAS_SCHEMA_VERSION: '0001_init',
      }),
    ).toEqual({
      service: 'atlas-api',
      appVersion: '0.1.0',
      gitSha: 'abc123',
      buildTime: '2026-07-24T00:00:00Z',
      schemaVersion: '0001_init',
      registryVersion: 1,
    });
  });

  it('does not invent missing deployment identity', () => {
    expect(loadBuildInfo({})).toEqual({
      service: 'atlas-api',
      appVersion: '0.1.0',
      gitSha: 'unknown',
      buildTime: 'unknown',
      schemaVersion: '0001_init',
      registryVersion: 1,
    });
  });

  it('prefers a known Railway commit over an unknown Docker build argument', () => {
    expect(
      loadBuildInfo({
        ATLAS_GIT_SHA: 'unknown',
        RAILWAY_GIT_COMMIT_SHA: 'railway123',
      }).gitSha,
    ).toBe('railway123');
  });
});

import { describe, expect, it } from 'vitest';
import { REGISTRY_VERSION } from '@atlas/registry';
import { loadBuildInfo } from './build-info.js';

describe('loadBuildInfo', () => {
  it('loads an explicit API deployment fingerprint', () => {
    expect(
      loadBuildInfo({
        ATLAS_GIT_SHA: 'abc1234',
        ATLAS_BUILD_TIME: '2026-07-24T00:00:00Z',
        ATLAS_SCHEMA_VERSION: '0001_init',
      }),
    ).toEqual({
      service: 'atlas-api',
      appVersion: '0.1.0',
      gitSha: 'abc1234',
      buildTime: '2026-07-24T00:00:00.000Z',
      schemaVersion: '0001_init',
      registryVersion: REGISTRY_VERSION,
    });
  });

  it('does not invent missing deployment identity', () => {
    expect(loadBuildInfo({})).toEqual({
      service: 'atlas-api',
      appVersion: '0.1.0',
      gitSha: 'unknown',
      buildTime: 'unknown',
      schemaVersion: '0001_init',
      registryVersion: REGISTRY_VERSION,
    });
  });

  it('prefers a known Railway commit over an unknown Docker build argument', () => {
    expect(
      loadBuildInfo({
        ATLAS_GIT_SHA: 'unknown',
        RAILWAY_GIT_COMMIT_SHA: 'abcdef123',
      }).gitSha,
    ).toBe('abcdef123');
  });

  it('normalizes safe fingerprint fields', () => {
    expect(
      loadBuildInfo({
        ATLAS_GIT_SHA: '  ABCDEF1  ',
        ATLAS_BUILD_TIME: ' 2026-07-24T00:00:00Z ',
        ATLAS_SCHEMA_VERSION: ' release_2026.07-24 ',
      }),
    ).toMatchObject({
      gitSha: 'abcdef1',
      buildTime: '2026-07-24T00:00:00.000Z',
      schemaVersion: 'release_2026.07-24',
    });
  });

  it('rejects malformed fingerprint fields and treats unknown case-insensitively', () => {
    expect(
      loadBuildInfo({
        ATLAS_GIT_SHA: ' UnKnOwN ',
        RAILWAY_GIT_COMMIT_SHA: 'not-a-git-sha',
        ATLAS_BUILD_TIME: 'July 24, 2026',
        ATLAS_SCHEMA_VERSION: 'release candidate/1',
      }),
    ).toMatchObject({
      gitSha: 'unknown',
      buildTime: 'unknown',
      schemaVersion: 'unknown',
    });
  });

  it('rejects an explicitly empty schema and an impossible ISO calendar date', () => {
    expect(
      loadBuildInfo({
        ATLAS_SCHEMA_VERSION: '   ',
        ATLAS_BUILD_TIME: '2026-02-30T00:00:00Z',
      }),
    ).toMatchObject({
      schemaVersion: 'unknown',
      buildTime: 'unknown',
    });
  });
});

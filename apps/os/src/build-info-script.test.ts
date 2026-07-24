import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { REGISTRY_VERSION } from '../../../packages/registry/registry.js';

const temporaryDirectories: string[] = [];
const script = resolve(process.cwd(), 'scripts/write-build-info.cjs');

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('OS build metadata generator', () => {
  it('writes the explicit deployment fingerprint to public/build-info.json', () => {
    const cwd = mkdtempSync(resolve(tmpdir(), 'atlas-os-build-info-'));
    temporaryDirectories.push(cwd);
    const result = spawnSync(process.execPath, [script], {
      cwd,
      env: {
        ...process.env,
        ATLAS_GIT_SHA: 'abc1234',
        ATLAS_BUILD_TIME: '2026-07-24T00:00:00Z',
        ATLAS_SCHEMA_VERSION: '0001_init',
      },
      encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(resolve(cwd, 'public/build-info.json'), 'utf8'))).toEqual({
      service: 'atlas-os',
      appVersion: '0.1.0',
      gitSha: 'abc1234',
      buildTime: '2026-07-24T00:00:00.000Z',
      schemaVersion: '0001_init',
      registryVersion: REGISTRY_VERSION,
    });
  });

  it('uses an explicit unknown commit and a truthful generation time when identity is unavailable', () => {
    const cwd = mkdtempSync(resolve(tmpdir(), 'atlas-os-build-info-'));
    temporaryDirectories.push(cwd);
    const env = { ...process.env };
    delete env.ATLAS_GIT_SHA;
    delete env.RAILWAY_GIT_COMMIT_SHA;
    delete env.ATLAS_BUILD_TIME;

    const result = spawnSync(process.execPath, [script], { cwd, env, encoding: 'utf8' });

    expect(result.status, result.stderr).toBe(0);
    const info = JSON.parse(readFileSync(resolve(cwd, 'public/build-info.json'), 'utf8')) as {
      gitSha: string;
      buildTime: string;
    };
    expect(info.gitSha).toBe('unknown');
    expect(Number.isNaN(Date.parse(info.buildTime))).toBe(false);
  });

  it('normalizes and validates public fingerprint fields', () => {
    const cwd = mkdtempSync(resolve(tmpdir(), 'atlas-os-build-info-'));
    temporaryDirectories.push(cwd);

    const result = spawnSync(process.execPath, [script], {
      cwd,
      env: {
        ...process.env,
        ATLAS_GIT_SHA: '  ABCDEF1  ',
        ATLAS_BUILD_TIME: ' 2026-07-24T00:00:00Z ',
        ATLAS_SCHEMA_VERSION: ' release_2026.07-24 ',
      },
      encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(resolve(cwd, 'public/build-info.json'), 'utf8'))).toMatchObject({
      gitSha: 'abcdef1',
      buildTime: '2026-07-24T00:00:00.000Z',
      schemaVersion: 'release_2026.07-24',
    });
  });

  it('publishes unknown instead of malformed fingerprint fields', () => {
    const cwd = mkdtempSync(resolve(tmpdir(), 'atlas-os-build-info-'));
    temporaryDirectories.push(cwd);

    const result = spawnSync(process.execPath, [script], {
      cwd,
      env: {
        ...process.env,
        ATLAS_GIT_SHA: ' UnKnOwN ',
        RAILWAY_GIT_COMMIT_SHA: 'not-a-git-sha',
        ATLAS_BUILD_TIME: ' UnKnOwN ',
        ATLAS_SCHEMA_VERSION: 'release candidate/1',
      },
      encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(resolve(cwd, 'public/build-info.json'), 'utf8'))).toMatchObject({
      gitSha: 'unknown',
      buildTime: 'unknown',
      schemaVersion: 'unknown',
    });
  });

  it('rejects an explicitly empty schema and an impossible ISO calendar date', () => {
    const cwd = mkdtempSync(resolve(tmpdir(), 'atlas-os-build-info-'));
    temporaryDirectories.push(cwd);

    const result = spawnSync(process.execPath, [script], {
      cwd,
      env: {
        ...process.env,
        ATLAS_SCHEMA_VERSION: '   ',
        ATLAS_BUILD_TIME: '2026-02-30T00:00:00Z',
      },
      encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(0);
    const info = JSON.parse(readFileSync(resolve(cwd, 'public/build-info.json'), 'utf8')) as {
      schemaVersion: string;
      buildTime: string;
    };
    expect(info.schemaVersion).toBe('unknown');
    expect(info.buildTime).toBe('unknown');
  });
});

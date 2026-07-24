import { REGISTRY_VERSION } from '@atlas/registry';
import { loadBuildEnv } from './env.js';

export interface BuildInfo {
  service: 'atlas-api';
  appVersion: string;
  gitSha: string;
  buildTime: string;
  schemaVersion: string;
  registryVersion: number;
}

export function loadBuildInfo(source: NodeJS.ProcessEnv = process.env): BuildInfo {
  const env = loadBuildEnv(source);

  return {
    service: 'atlas-api',
    appVersion: '0.1.0',
    gitSha: env.gitSha,
    buildTime: env.buildTime,
    schemaVersion: env.schemaVersion,
    registryVersion: REGISTRY_VERSION,
  };
}

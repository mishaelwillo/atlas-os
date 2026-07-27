/// <reference types="vite/client" />

/** Commit this bundle was built from; injected by vite.config.ts. */
declare const __ATLAS_BUILD_SHA__: string;

interface AtlasBuildInfo {
  service: 'atlas-os';
  appVersion: string;
  gitSha: string;
  buildTime: string;
  schemaVersion: string;
  registryVersion: number;
}

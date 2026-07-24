/// <reference types="vite/client" />

interface AtlasBuildInfo {
  service: 'atlas-os';
  appVersion: string;
  gitSha: string;
  buildTime: string;
  schemaVersion: string;
  registryVersion: number;
}

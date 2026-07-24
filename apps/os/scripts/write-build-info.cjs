const fs = require('node:fs');
const path = require('node:path');

const knownValue = (...values) =>
  values.find((value) => value !== undefined && value !== '' && value !== 'unknown');

const info = {
  service: 'atlas-os',
  appVersion: '0.1.0',
  gitSha:
    knownValue(process.env.ATLAS_GIT_SHA, process.env.RAILWAY_GIT_COMMIT_SHA) ?? 'unknown',
  buildTime: knownValue(process.env.ATLAS_BUILD_TIME) ?? new Date().toISOString(),
  schemaVersion: knownValue(process.env.ATLAS_SCHEMA_VERSION) ?? '0001_init',
  registryVersion: 1,
};

const publicDirectory = path.resolve('public');
fs.mkdirSync(publicDirectory, { recursive: true });
fs.writeFileSync(
  path.resolve(publicDirectory, 'build-info.json'),
  `${JSON.stringify(info, null, 2)}\n`,
);

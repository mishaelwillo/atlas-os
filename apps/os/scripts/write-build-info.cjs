const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const normalizedValue = (value) => {
  const normalized = value?.trim();
  if (!normalized || normalized.toLowerCase() === 'unknown') return undefined;
  return normalized;
};

const gitSha = (...values) => {
  for (const value of values) {
    const normalized = normalizedValue(value);
    if (normalized && /^[0-9a-f]{7,64}$/i.test(normalized)) return normalized.toLowerCase();
  }
  return 'unknown';
};

const buildTime = (value) => {
  const normalized = normalizedValue(value);
  const match =
    normalized?.match(
      /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i,
    ) ?? null;
  if (!match) return 'unknown';

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth =
    month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
  if (day < 1 || day > daysInMonth) return 'unknown';

  const timestamp = Date.parse(normalized);
  return Number.isNaN(timestamp) ? 'unknown' : new Date(timestamp).toISOString();
};

const schemaVersion = (value) => {
  // An absent variable means the build cannot observe the deployed migration.
  // Say so, rather than asserting one — a wrong identity here is worse than
  // an admitted unknown, and the fingerprint validator accepts 'unknown'.
  const normalized = normalizedValue(value);
  if (normalized === undefined) return 'unknown';
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(normalized) ? normalized : 'unknown';
};

async function main() {
  const registryModule = pathToFileURL(
    path.resolve(__dirname, '../../../packages/registry/dist/registry.js'),
  ).href;
  const { REGISTRY_VERSION } = await import(registryModule);
  const info = {
    service: 'atlas-os',
    appVersion: '0.1.0',
    gitSha: gitSha(process.env.ATLAS_GIT_SHA, process.env.RAILWAY_GIT_COMMIT_SHA),
    buildTime:
      process.env.ATLAS_BUILD_TIME === undefined
        ? new Date().toISOString()
        : buildTime(process.env.ATLAS_BUILD_TIME),
    schemaVersion: schemaVersion(process.env.ATLAS_SCHEMA_VERSION),
    registryVersion: REGISTRY_VERSION,
  };

  const publicDirectory = path.resolve('public');
  fs.mkdirSync(publicDirectory, { recursive: true });
  fs.writeFileSync(
    path.resolve(publicDirectory, 'build-info.json'),
    `${JSON.stringify(info, null, 2)}\n`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

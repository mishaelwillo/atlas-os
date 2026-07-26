import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditResearchArtifactStore, loadResearchFiles } from './research.js';

async function main(): Promise<void> {
  const forwarded = process.argv.slice(2).filter((argument) => argument !== '--');
  const watchRoot = forwarded[0];
  if (!watchRoot) {
    throw new Error('usage: pnpm --filter @atlas/control-schema audit:research -- <watch-root>');
  }

  const repositoryRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
  const { manifest } = await loadResearchFiles(repositoryRoot);
  const failures = await auditResearchArtifactStore(manifest, resolve(watchRoot));
  if (failures.length > 0) {
    throw new Error(failures.join('\n'));
  }
  console.log(`Verified ${manifest.artifacts.length} retained research artifacts.`);
}

await main();

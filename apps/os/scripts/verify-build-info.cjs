const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const repositoryRoot = path.resolve(__dirname, '../../..');
const pnpmCli = process.env.npm_execpath;

async function main() {
const { REGISTRY_VERSION } = await import(
  pathToFileURL(path.resolve(repositoryRoot, 'packages/registry/dist/registry.js')).href
);

const fixedEnvironment = {
  ...process.env,
  RAILWAY_GIT_COMMIT_SHA: '',
  ATLAS_BUILD_TIME: '2026-07-24T00:00:00.000Z',
  ATLAS_SCHEMA_VERSION: 'verify_0001',
};

const runTurbo = (turboArguments, environment) => {
  const pnpmArguments = ['exec', 'turbo', ...turboArguments];
  const command = pnpmCli
    ? process.execPath
    : process.platform === 'win32'
      ? (process.env.ComSpec ?? 'cmd.exe')
      : 'pnpm';
  const arguments_ = pnpmCli
    ? [pnpmCli, ...pnpmArguments]
    : process.platform === 'win32'
      ? ['/d', '/s', '/c', 'pnpm', ...pnpmArguments]
      : pnpmArguments;
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    env: environment,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Turbo exited with ${result.status}`);
  }
  return result.stdout;
};

const dryTask = (gitSha) => {
  const report = JSON.parse(
    runTurbo(['run', 'build', '--filter=@atlas/os', '--dry=json'], {
      ...fixedEnvironment,
      ATLAS_GIT_SHA: gitSha,
    }),
  );
  const task = report.tasks.find((candidate) => candidate.taskId === '@atlas/os#build');
  if (!task) throw new Error('Turbo dry-run did not report @atlas/os#build');
  return task;
};

const firstSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const secondSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const firstTask = dryTask(firstSha);
const secondTask = dryTask(secondSha);
if (firstTask.hash === secondTask.hash) {
  throw new Error('OS build hash did not change when ATLAS_GIT_SHA changed');
}
if (JSON.stringify(firstTask.resolvedTaskDefinition.dependsOn) !== JSON.stringify(['^build'])) {
  throw new Error('OS build does not preserve the ^build dependency');
}
if (
  JSON.stringify([...firstTask.resolvedTaskDefinition.outputs].sort()) !==
  JSON.stringify(['build/**', 'dist/**'])
) {
  throw new Error('OS build does not preserve cacheable dist/build outputs');
}

runTurbo(['run', 'build', '--filter=@atlas/os', '--force'], {
  ...fixedEnvironment,
  ATLAS_GIT_SHA: secondSha,
});

const generated = JSON.parse(
  fs.readFileSync(path.resolve(repositoryRoot, 'apps/os/dist/build-info.json'), 'utf8'),
);
const expected = {
  service: 'atlas-os',
  appVersion: '0.1.0',
  gitSha: secondSha,
  buildTime: fixedEnvironment.ATLAS_BUILD_TIME,
  schemaVersion: fixedEnvironment.ATLAS_SCHEMA_VERSION,
  registryVersion: REGISTRY_VERSION,
};
if (JSON.stringify(generated) !== JSON.stringify(expected)) {
  throw new Error(
    `Generated dist/build-info.json did not match supplied safe values:\n${JSON.stringify(generated, null, 2)}`,
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      hashesDiffer: true,
      dependsOn: firstTask.resolvedTaskDefinition.dependsOn,
      outputs: firstTask.resolvedTaskDefinition.outputs,
      generated,
    },
    null,
    2,
  ),
);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

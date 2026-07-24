import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

interface DryRunTask {
  hash: string;
  resolvedTaskDefinition: {
    dependsOn: string[];
    outputs: string[];
  };
}

function osBuildTask(gitSha: string): DryRunTask {
  const pnpmCli = process.env.npm_execpath;
  const pnpmArguments = ['exec', 'turbo', 'run', 'build', '--filter=@atlas/os', '--dry=json'];
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

  const result = spawnSync(
    command,
    arguments_,
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ATLAS_GIT_SHA: gitSha,
        RAILWAY_GIT_COMMIT_SHA: '',
        ATLAS_BUILD_TIME: '2026-07-24T00:00:00.000Z',
        ATLAS_SCHEMA_VERSION: '0001_init',
      },
      encoding: 'utf8',
    },
  );

  expect(result.status, result.stderr).toBe(0);
  const report = JSON.parse(result.stdout) as {
    tasks: Array<DryRunTask & { taskId: string }>;
  };
  const task = report.tasks.find((candidate) => candidate.taskId === '@atlas/os#build');
  if (!task) throw new Error('Turbo dry-run did not report @atlas/os#build');
  return task;
}

describe('OS Turbo build fingerprint inputs', () => {
  it('changes the build hash when the supplied commit changes', () => {
    const first = osBuildTask('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const second = osBuildTask('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');

    expect(first.hash).not.toBe(second.hash);
  });

  it('preserves dependency builds and cacheable output declarations', () => {
    const task = osBuildTask('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

    expect(task.resolvedTaskDefinition.dependsOn).toEqual(['^build']);
    expect([...task.resolvedTaskDefinition.outputs].sort()).toEqual(['build/**', 'dist/**']);
  });
});

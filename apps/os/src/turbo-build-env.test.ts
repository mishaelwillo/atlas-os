import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

function osBuildHash(gitSha: string): string {
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
    tasks: Array<{ taskId: string; hash: string }>;
  };
  const task = report.tasks.find((candidate) => candidate.taskId === '@atlas/os#build');
  if (!task) throw new Error('Turbo dry-run did not report @atlas/os#build');
  return task.hash;
}

describe('OS Turbo build fingerprint inputs', () => {
  it('changes the build hash when the supplied commit changes', () => {
    const first = osBuildHash('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const second = osBuildHash('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');

    expect(first).not.toBe(second);
  });
});

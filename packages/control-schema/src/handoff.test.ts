import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { archiveCurrentHandoff, runArchiveHandoffCli } from './archive-handoff.js';
import { runCreateHandoffCli } from './create-handoff.js';
import { createHandoff } from './handoff.js';
import { WorkQueueSchema } from './schemas.js';

const roots: string[] = [];
const now = new Date('2026-07-24T15:30:00.000Z');

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function git(root: string, ...args: string[]): string {
  const effectiveArgs =
    args[0] === 'init'
      ? args
      : ['-c', `core.excludesFile=${join(root, '.git', 'info', 'exclude')}`, ...args];
  return execFileSync('git', effectiveArgs, {
    cwd: root,
    encoding: 'utf8',
  }).trim();
}

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'atlas-handoff-'));
  roots.push(root);
  await mkdir(join(root, 'docs', 'control', 'generated'), { recursive: true });
  await mkdir(join(root, 'docs', 'control', 'handoffs', 'archived'), { recursive: true });
  await writeFile(
    join(root, 'docs', 'control', 'WORK_QUEUE.yaml'),
    `schema_version: 1
items:
  - id: P2A-CONTROL-001
    phase: P2A
    title: Establish continuity
    status: in_progress
    priority: critical
    dependencies: []
    specification: CONTINUITY_DESIGN.md
    acceptance_checks:
      - Handoff tooling passes
    next_action: Add Task 6 CI gate
  - id: P1-DEPLOY-001
    phase: P1 deployment closure
    title: Close deployment
    status: ready
    priority: critical
    dependencies:
      - P2A-CONTROL-001
    specification: DEPLOYMENT_RUNBOOK.md
    acceptance_checks:
      - Production fingerprint matches
    next_action: Wait for continuity
`,
    'utf8',
  );
  await writeFile(
    join(root, 'docs', 'control', 'CURRENT_HANDOFF.md'),
    `# Current Handoff

**Handoff ID:** \`previous-handoff\`
**Status:** active
**Updated:** 2026-07-24T14:00:00.000Z
**Actor:** Codex
**Objective:** Finish the prior task.

## Active work

- Work item: \`P2A-CONTROL-001\`
- Branch: \`codex/atlas-continuity\`
- Base commit: \`1111111111111111111111111111111111111111\`
- Head commit: \`2222222222222222222222222222222222222222\`
- Review status: approved
`,
    'utf8',
  );
  await writeFile(
    join(root, 'docs', 'control', 'generated', 'observed-state.json'),
    JSON.stringify({
      localGit: { value: { branch: 'stale/branch', sha: '3333333' } },
      accidental: 'PASSWORD=must-not-be-copied',
    }),
    'utf8',
  );
  await writeFile(join(root, 'tracked.txt'), 'baseline\n', 'utf8');
  git(root, 'init', '-b', 'codex/atlas-continuity');
  git(root, 'config', 'user.email', 'atlas-test@example.test');
  git(root, 'config', 'user.name', 'Atlas Test');
  git(root, 'config', 'core.autocrlf', 'false');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'fixture');
  await writeFile(join(root, 'tracked.txt'), 'changed\n', 'utf8');
  return root;
}

describe('createHandoff', () => {
  it('renders the complete structured takeover record', () => {
    const markdown = createHandoff(
      {
        id: 'continuity-task-5',
        actor: 'Codex',
        objective: 'Automate safe model handoffs.',
        workItem: 'P2A-CONTROL-001',
        nextAction: 'Run pnpm control:verify.',
        definitionOfDone: 'Task 5 tests, build, and verification pass.',
      },
      {
        updatedAt: '2026-07-24T15:30:00.000Z',
        branch: 'codex/atlas-continuity',
        baseCommit: '1111111111111111111111111111111111111111',
        headCommit: '2222222222222222222222222222222222222222',
        reviewStatus: 'pending independent review',
        filesChanged: [' M tracked.txt', ' M docs/control/CURRENT_HANDOFF.md'],
        testEvidence: ['RED: handoff implementation was absent.', 'GREEN: focused tests pass.'],
        databaseActions: ['None.'],
        hostingActions: ['None.'],
        externalSideEffects: ['None.'],
        blockers: ['Production deployment remains blocked.'],
      },
    );

    expect(markdown).toContain('**Handoff ID:** `continuity-task-5`');
    expect(markdown).toContain('**Actor:** Codex');
    expect(markdown).toContain('**Objective:** Automate safe model handoffs.');
    expect(markdown).toContain('- Work item: `P2A-CONTROL-001`');
    expect(markdown).toContain('- Branch: `codex/atlas-continuity`');
    expect(markdown).toContain('- Base commit: `1111111111111111111111111111111111111111`');
    expect(markdown).toContain('- Head commit: `2222222222222222222222222222222222222222`');
    expect(markdown).toContain('- Review status: pending independent review');
    expect(markdown).toContain('- ` M tracked.txt`');
    expect(markdown).toContain('- RED: handoff implementation was absent.');
    expect(markdown).toContain('- None.\n\n## Hosting actions');
    expect(markdown).toContain('## Blockers');
    expect(markdown).toContain('Run pnpm control:verify.');
    expect(markdown).toContain('Task 5 tests, build, and verification pass.');
    expect(markdown.endsWith('\n')).toBe(true);
  });
});

describe('handoff creation CLI', () => {
  it('uses the active queue item and live local Git state without copying generated evidence', async () => {
    const root = await fixtureRoot();
    const lines: string[] = [];

    const exitCode = await runCreateHandoffCli(
      root,
      [
        '--',
        '--id',
        'continuity-task-5',
        '--actor',
        'Codex',
        '--objective',
        'Automate safe model handoffs.',
        '--next',
        'Run pnpm control:verify.',
        '--definition-of-done',
        'Task 5 is independently reviewed.',
      ],
      (line) => lines.push(line),
      now,
    );

    expect(exitCode).toBe(0);
    const current = await readFile(
      join(root, 'docs', 'control', 'CURRENT_HANDOFF.md'),
      'utf8',
    );
    const head = git(root, 'rev-parse', 'HEAD');
    expect(current).toContain('- Work item: `P2A-CONTROL-001`');
    expect(current).toContain('- Branch: `codex/atlas-continuity`');
    expect(current).toContain(`- Head commit: \`${head}\``);
    expect(current).toContain('- Base commit: `1111111111111111111111111111111111111111`');
    expect(current).toContain('- Review status: pending independent review');
    expect(current).toContain('- ` M tracked.txt`');
    expect(current).toContain('- Database actions: no actions recorded by this command.');
    expect(current).toContain('- Hosting actions: no actions recorded by this command.');
    expect(current).not.toContain('must-not-be-copied');
    expect(current).not.toContain('stale/branch');
    expect(lines).toEqual(['Created docs/control/CURRENT_HANDOFF.md']);
  });

  it.each([
    [['--objective', 'Missing ID.', '--next', 'Run verification.'], /--id is required/],
    [
      ['--id', '../escape', '--objective', 'Unsafe ID.', '--next', 'Run verification.'],
      /--id must be a stable lowercase/,
    ],
    [
      ['--id', 'safe-id', '--objective', 'Line one\nLine two', '--next', 'Run verification.'],
      /--objective must be a single line/,
    ],
    [
      ['--id', 'safe-id', '--objective', 'Safe objective.', '--next', 'PASSWORD=example-value'],
      /--next contains secret-like content/,
    ],
    [
      [
        '--id',
        'safe-id',
        '--objective',
        'Safe objective.',
        '--next',
        'Run verification.',
        '--work-item',
        '../../outside',
      ],
      /--work-item contains unsafe characters/,
    ],
  ])('rejects invalid arguments with a nonzero helpful error', async (args, message) => {
    const root = await fixtureRoot();
    const original = await readFile(
      join(root, 'docs', 'control', 'CURRENT_HANDOFF.md'),
      'utf8',
    );
    const lines: string[] = [];

    const exitCode = await runCreateHandoffCli(root, args, (line) => lines.push(line), now);

    expect(exitCode).toBe(1);
    expect(lines.join('\n')).toMatch(message);
    expect(await readFile(join(root, 'docs', 'control', 'CURRENT_HANDOFF.md'), 'utf8')).toBe(
      original,
    );
  });

  it('rejects a work-item override that is not the unique in-progress item', async () => {
    const root = await fixtureRoot();
    const lines: string[] = [];

    const exitCode = await runCreateHandoffCli(
      root,
      [
        '--id',
        'safe-id',
        '--objective',
        'Safe objective.',
        '--next',
        'Run verification.',
        '--work-item',
        'P1-DEPLOY-001',
      ],
      (line) => lines.push(line),
      now,
    );

    expect(exitCode).toBe(1);
    expect(lines.join('\n')).toContain(
      '--work-item must match the single in_progress item P2A-CONTROL-001',
    );
  });
});

describe('handoff archival', () => {
  it('archives deterministically and replaces current with a schema-compatible unassigned record', async () => {
    const root = await fixtureRoot();

    const archivePath = await archiveCurrentHandoff(root, now);

    expect(archivePath.replaceAll('\\', '/')).toBe(
      'docs/control/handoffs/archived/2026-07-24-previous-handoff.md',
    );
    const archived = await readFile(join(root, archivePath), 'utf8');
    const current = await readFile(
      join(root, 'docs', 'control', 'CURRENT_HANDOFF.md'),
      'utf8',
    );
    expect(archived).toContain('**Handoff ID:** `previous-handoff`');
    expect(current).toContain('**Handoff ID:** `unassigned-2026-07-24`');
    expect(current).toContain('**Actor:** Unassigned');
    expect(current).toContain('- Work item: `P2A-CONTROL-001`');
    expect(current).toContain('- Base commit: `1111111111111111111111111111111111111111`');
    expect(current).toContain('- Head commit: `2222222222222222222222222222222222222222`');
    expect(current).toContain('- Review status: approved');
    expect(current).toContain('select a ready work item from WORK_QUEUE.yaml.');
    expect(
      WorkQueueSchema.parse(
        parse(await readFile(join(root, 'docs', 'control', 'WORK_QUEUE.yaml'), 'utf8')),
      ).items.filter((item) => item.status === 'in_progress'),
    ).toHaveLength(1);
  });

  it('refuses an archive collision without changing either record', async () => {
    const root = await fixtureRoot();
    const collision = join(
      root,
      'docs',
      'control',
      'handoffs',
      'archived',
      '2026-07-24-previous-handoff.md',
    );
    await writeFile(collision, 'immutable prior archive\n', 'utf8');
    const original = await readFile(
      join(root, 'docs', 'control', 'CURRENT_HANDOFF.md'),
      'utf8',
    );

    await expect(archiveCurrentHandoff(root, now)).rejects.toThrow(/refusing to overwrite/i);
    expect(await readFile(collision, 'utf8')).toBe('immutable prior archive\n');
    expect(await readFile(join(root, 'docs', 'control', 'CURRENT_HANDOFF.md'), 'utf8')).toBe(
      original,
    );
  });

  it('rejects an unsafe handoff ID before constructing an archive path', async () => {
    const root = await fixtureRoot();
    const currentPath = join(root, 'docs', 'control', 'CURRENT_HANDOFF.md');
    await writeFile(
      currentPath,
      (await readFile(currentPath, 'utf8')).replace('previous-handoff', '../outside'),
      'utf8',
    );

    await expect(archiveCurrentHandoff(root, now)).rejects.toThrow(/unsafe handoff ID/i);
  });

  it('refuses to copy a secret-bearing current handoff into the archive', async () => {
    const root = await fixtureRoot();
    const currentPath = join(root, 'docs', 'control', 'CURRENT_HANDOFF.md');
    await writeFile(
      currentPath,
      `${await readFile(currentPath, 'utf8')}\nBlocked command: PASSWORD=do-not-archive\n`,
      'utf8',
    );

    await expect(archiveCurrentHandoff(root, now)).rejects.toThrow(/secret-like content/i);
    await expect(
      readFile(
        join(
          root,
          'docs',
          'control',
          'handoffs',
          'archived',
          '2026-07-24-previous-handoff.md',
        ),
        'utf8',
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('returns a helpful nonzero CLI result when archival fails', async () => {
    const root = await fixtureRoot();
    const lines: string[] = [];
    await writeFile(
      join(
        root,
        'docs',
        'control',
        'handoffs',
        'archived',
        '2026-07-24-previous-handoff.md',
      ),
      'existing\n',
      'utf8',
    );

    const exitCode = await runArchiveHandoffCli(root, (line) => lines.push(line), now);

    expect(exitCode).toBe(1);
    expect(lines.join('\n')).toMatch(/refusing to overwrite/i);
  });
});

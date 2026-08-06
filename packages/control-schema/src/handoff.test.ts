import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
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
  await Promise.all(
    roots
      .splice(0)
      .map((root) =>
        rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }),
      ),
  );
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

async function fixtureRoot(
  options: {
    dirty?: boolean;
    generated?: unknown | 'absent';
    currentId?: string;
    currentStarted?: string;
    activeWorkItemId?: string;
  } = {},
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'atlas-handoff-'));
  roots.push(root);
  await mkdir(join(root, 'docs', 'control', 'generated'), { recursive: true });
  await mkdir(join(root, 'docs', 'control', 'handoffs', 'archived'), { recursive: true });
  await writeFile(
    join(root, 'docs', 'control', 'WORK_QUEUE.yaml'),
    `schema_version: 1
items:
  - id: ${options.activeWorkItemId ?? 'P2A-CONTROL-001'}
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

**Handoff ID:** \`${options.currentId ?? 'previous-handoff'}\`
**Status:** active
**Started:** ${options.currentStarted ?? '2026-07-24T13:00:00.000Z'}
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
  if (options.generated !== 'absent') {
    await writeFile(
      join(root, 'docs', 'control', 'generated', 'observed-state.json'),
      JSON.stringify(
        options.generated ?? {
          schemaVersion: 1,
          collectedAt: '2026-07-24T15:00:00.000Z',
          provenance: {
            collector: '@atlas/control-schema',
            mode: 'live-read-only',
            sources: ['local Git', 'GitHub', 'Supabase', 'Railway'],
          },
          localGit: { status: 'ok', checkedAt: '2026-07-24T15:00:00.000Z' },
          github: { status: 'ok', checkedAt: '2026-07-24T15:00:00.000Z' },
          supabase: {
            status: 'ok',
            checkedAt: '2026-07-24T15:00:00.000Z',
            value: { tables: ['memory_cards'] },
          },
          railwayApi: {
            status: 'drift',
            checkedAt: '2026-07-24T15:00:00.000Z',
            error: 'PASSWORD=must-not-be-copied',
          },
          railwayOs: {
            status: 'ok',
            checkedAt: '2026-07-24T15:00:00.000Z',
          },
          registry: { status: 'ok', checkedAt: '2026-07-24T15:00:00.000Z' },
        },
      ),
      'utf8',
    );
  }
  await writeFile(join(root, 'tracked.txt'), 'baseline\n', 'utf8');
  git(root, 'init', '-b', 'codex/atlas-continuity');
  git(root, 'config', 'user.email', 'atlas-test@example.test');
  git(root, 'config', 'user.name', 'Atlas Test');
  git(root, 'config', 'core.autocrlf', 'false');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'fixture');
  if (options.dirty !== false) {
    await writeFile(join(root, 'tracked.txt'), 'changed\n', 'utf8');
  }
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
        startedAt: '2026-07-24T15:00:00.000Z',
        updatedAt: '2026-07-24T15:30:00.000Z',
        branch: 'codex/atlas-continuity',
        baseCommit: '1111111111111111111111111111111111111111',
        headCommit: '2222222222222222222222222222222222222222',
        reviewStatus: 'pending independent review',
        taskChangeEvidence: ['Commit abc123 implements the handoff writer.'],
        workingTreeChanges: [' M tracked.txt'],
        testEvidence: ['RED: handoff implementation was absent.', 'GREEN: focused tests pass.'],
        databaseActions: ['None.'],
        hostingActions: ['None.'],
        externalSideEffects: ['None.'],
        blockers: ['Production deployment remains blocked.'],
      },
    );

    expect(markdown).toContain('**Handoff ID:** `continuity-task-5`');
    expect(markdown).toContain('**Started:** 2026-07-24T15:00:00.000Z');
    expect(markdown).toContain('**Updated:** 2026-07-24T15:30:00.000Z');
    expect(markdown).toContain('**Actor:** Codex');
    expect(markdown).toContain('**Objective:** Automate safe model handoffs.');
    expect(markdown).toContain('- Work item: `P2A-CONTROL-001`');
    expect(markdown).toContain('- Branch: `codex/atlas-continuity`');
    expect(markdown).toContain('- Base commit: `1111111111111111111111111111111111111111`');
    expect(markdown).toContain('- Head commit: `2222222222222222222222222222222222222222`');
    expect(markdown).toContain('- Review status: pending independent review');
    expect(markdown).toContain('## Task change evidence');
    expect(markdown).toContain('- Commit abc123 implements the handoff writer.');
    expect(markdown).toContain('## Current working tree');
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
        '--task-change',
        'Commit abc123 implements the task.',
        '--evidence',
        'Focused tests passed.',
        '--evidence',
        'Full build passed.',
        '--database-action',
        'No database mutation performed.',
        '--hosting-action',
        'No hosting mutation performed.',
        '--side-effect',
        'Created a repository-local handoff.',
        '--blocker',
        'Independent review remains pending.',
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
    expect(current).toContain('**Started:** 2026-07-24T15:30:00.000Z');
    expect(current).toContain('**Updated:** 2026-07-24T15:30:00.000Z');
    expect(current).toContain('- ` M tracked.txt`');
    expect(current).toContain('- Commit abc123 implements the task.');
    expect(current).toContain('- Focused tests passed.');
    expect(current).toContain('- Full build passed.');
    expect(current).toContain('- No database mutation performed.');
    expect(current).toContain('- No hosting mutation performed.');
    expect(current).toContain('- Created a repository-local handoff.');
    expect(current).toContain('- Independent review remains pending.');
    expect(current).toContain(
      '- Observed Supabase status: ok (live-read-only at 2026-07-24T15:00:00.000Z).',
    );
    expect(current).toContain(
      '- Observed Railway API status: drift; OS status: ok (live-read-only at 2026-07-24T15:00:00.000Z).',
    );
    expect(current).not.toContain('must-not-be-copied');
    expect(current).not.toContain('stale/branch');
    expect(lines).toEqual(['Created docs/control/CURRENT_HANDOFF.md']);
  });

  it('reports a clean current working tree without historical task files', async () => {
    const root = await fixtureRoot({ dirty: false, generated: 'absent' });

    const exitCode = await runCreateHandoffCli(
      root,
      [
        '--id',
        'clean-handoff',
        '--objective',
        'Capture a clean repository.',
        '--next',
        'Review the clean handoff.',
      ],
      () => undefined,
      now,
    );

    expect(exitCode).toBe(0);
    const current = await readFile(join(root, 'docs', 'control', 'CURRENT_HANDOFF.md'), 'utf8');
    expect(current).toContain('## Current working tree\n\n- Clean.');
    expect(current).toContain('## Task change evidence\n\n- Not supplied.');
    expect(current).not.toContain('?? packages/');
  });

  it('fails safely when generated observed state is malformed', async () => {
    const root = await fixtureRoot({ generated: { schemaVersion: 1, supabase: { status: 'ok' } } });
    const original = await readFile(join(root, 'docs', 'control', 'CURRENT_HANDOFF.md'), 'utf8');
    const lines: string[] = [];

    const exitCode = await runCreateHandoffCli(
      root,
      [
        '--id',
        'malformed-observation',
        '--objective',
        'Reject malformed evidence.',
        '--next',
        'Repair observed state.',
      ],
      (line) => lines.push(line),
      now,
    );

    expect(exitCode).toBe(1);
    expect(lines.join('\n')).toMatch(/observed-state\.json is invalid/i);
    expect(await readFile(join(root, 'docs', 'control', 'CURRENT_HANDOFF.md'), 'utf8')).toBe(
      original,
    );
  });

  it.each([
    {
      label: '--id',
      args: [
        '--id',
        'sk-abcdef',
        '--objective',
        'Reject a secret-like ID.',
        '--next',
        'Keep the current handoff.',
      ],
      options: {},
    },
    {
      label: '--actor',
      args: [
        '--id',
        'safe-handoff',
        '--actor',
        'sk-abcdef',
        '--objective',
        'Reject a secret-like actor.',
        '--next',
        'Keep the current handoff.',
      ],
      options: {},
    },
    {
      label: '--work-item',
      args: [
        '--id',
        'safe-handoff',
        '--objective',
        'Reject a secret-like work item.',
        '--next',
        'Keep the current handoff.',
        '--work-item',
        'sk-abcdef',
      ],
      options: { activeWorkItemId: 'sk-abcdef' },
    },
  ])('rejects secret-like $label scalar input without changing current', async ({ args, options }) => {
    const root = await fixtureRoot({ generated: 'absent', ...options });
    const currentPath = join(root, 'docs', 'control', 'CURRENT_HANDOFF.md');
    const original = await readFile(currentPath, 'utf8');
    const lines: string[] = [];

    expect(
      await runCreateHandoffCli(root, args, (line) => lines.push(line), now),
    ).toBe(1);
    expect(lines.join('\n')).toMatch(/secret-like content/i);
    expect(await readFile(currentPath, 'utf8')).toBe(original);
  });

  it('rejects a secret-like queue-sourced active work item before rendering', async () => {
    const root = await fixtureRoot({
      generated: 'absent',
      activeWorkItemId: 'sk-abcdef',
    });
    const currentPath = join(root, 'docs', 'control', 'CURRENT_HANDOFF.md');
    const original = await readFile(currentPath, 'utf8');
    const lines: string[] = [];

    expect(
      await runCreateHandoffCli(
        root,
        [
          '--id',
          'safe-handoff',
          '--objective',
          'Reject unsafe queue data.',
          '--next',
          'Keep the current handoff.',
        ],
        (line) => lines.push(line),
        now,
      ),
    ).toBe(1);
    expect(lines.join('\n')).toMatch(/secret-like content/i);
    expect(await readFile(currentPath, 'utf8')).toBe(original);
  });

  it('preserves a valid prior Started timestamp when updating the same handoff ID', async () => {
    const root = await fixtureRoot({ generated: 'absent' });

    expect(
      await runCreateHandoffCli(
        root,
        [
          '--id',
          'previous-handoff',
          '--objective',
          'Continue the same handoff.',
          '--next',
          'Review the updated evidence.',
        ],
        () => undefined,
        now,
      ),
    ).toBe(0);
    const current = await readFile(join(root, 'docs', 'control', 'CURRENT_HANDOFF.md'), 'utf8');
    expect(current).toContain('**Started:** 2026-07-24T13:00:00.000Z');
    expect(current).toContain('**Updated:** 2026-07-24T15:30:00.000Z');
  });

  it('uses now as Started when the handoff ID changes', async () => {
    const root = await fixtureRoot({ generated: 'absent' });

    expect(
      await runCreateHandoffCli(
        root,
        [
          '--id',
          'replacement-handoff',
          '--objective',
          'Start a replacement handoff.',
          '--next',
          'Review the replacement.',
        ],
        () => undefined,
        now,
      ),
    ).toBe(0);
    const current = await readFile(join(root, 'docs', 'control', 'CURRENT_HANDOFF.md'), 'utf8');
    expect(current).toContain('**Started:** 2026-07-24T15:30:00.000Z');
    expect(current).toContain('**Updated:** 2026-07-24T15:30:00.000Z');
  });

  it('does not preserve an invalid prior Started timestamp for the same ID', async () => {
    const root = await fixtureRoot({
      generated: 'absent',
      currentStarted: 'not-a-timestamp',
    });

    expect(
      await runCreateHandoffCli(
        root,
        [
          '--id',
          'previous-handoff',
          '--objective',
          'Repair invalid prior metadata.',
          '--next',
          'Review the repaired timestamp.',
        ],
        () => undefined,
        now,
      ),
    ).toBe(0);
    const current = await readFile(join(root, 'docs', 'control', 'CURRENT_HANDOFF.md'), 'utf8');
    expect(current).toContain('**Started:** 2026-07-24T15:30:00.000Z');
    expect(current).toContain('**Updated:** 2026-07-24T15:30:00.000Z');
    expect(current).not.toContain('not-a-timestamp');
  });

  it.each([
    '--task-change',
    '--evidence',
    '--database-action',
    '--hosting-action',
    '--side-effect',
    '--blocker',
  ])('rejects secret-bearing repeatable %s input', async (flag) => {
    const root = await fixtureRoot({ generated: 'absent' });
    const lines: string[] = [];

    const exitCode = await runCreateHandoffCli(
      root,
      [
        '--id',
        'safe-handoff',
        '--objective',
        'Capture safe evidence.',
        '--next',
        'Run verification.',
        flag,
        'PASSWORD=do-not-record',
      ],
      (line) => lines.push(line),
      now,
    );

    expect(exitCode).toBe(1);
    expect(lines.join('\n')).toMatch(/secret-like content/i);
  });

  it('selectively summarizes observed state without leaking raw values or errors', async () => {
    const secret = ['postgresql:', '//admin:do-not-copy@example.test/database'].join('');
    const root = await fixtureRoot({
      generated: {
        schemaVersion: 1,
        collectedAt: '2026-07-24T15:00:00.000Z',
        provenance: {
          collector: '@atlas/control-schema',
          mode: 'live-read-only',
          sources: [secret],
        },
        localGit: { status: 'ok', checkedAt: '2026-07-24T15:00:00.000Z' },
        github: { status: 'unknown', checkedAt: '2026-07-24T15:00:00.000Z' },
        supabase: {
          status: 'unknown',
          checkedAt: '2026-07-24T15:00:00.000Z',
          error: secret,
        },
        railwayApi: {
          status: 'error',
          checkedAt: '2026-07-24T15:00:00.000Z',
          error: `Bearer ${secret}`,
        },
        railwayOs: { status: 'unknown', checkedAt: '2026-07-24T15:00:00.000Z' },
        registry: { status: 'ok', checkedAt: '2026-07-24T15:00:00.000Z' },
      },
    });

    expect(
      await runCreateHandoffCli(
        root,
        [
          '--id',
          'safe-summary',
          '--objective',
          'Summarize observed status.',
          '--next',
          'Review the summary.',
        ],
        () => undefined,
        now,
      ),
    ).toBe(0);
    const output = await readFile(join(root, 'docs', 'control', 'CURRENT_HANDOFF.md'), 'utf8');
    expect(output).toContain('Observed Supabase status: unknown');
    expect(output).toContain('Observed Railway API status: error; OS status: unknown');
    expect(output).not.toContain(secret);
    expect(output).not.toContain('Bearer');
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
    expect(current).toContain('**Started:** 2026-07-24T15:30:00.000Z');
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

  /**
   * The takeover point has to be one verification accepts.
   *
   * It used to copy the archived handoff's branch forward, so after a merge
   * the replacement named a branch nothing was happening on any more and
   * `control:verify` blocked with `handoff_branch_mismatch` — the artifact
   * whose whole purpose is "a safe place for the next model to start" was
   * reliably unsafe, and every session after a merge opened on a blocking
   * finding that meant nothing.
   */
  it('records the branch the worktree is on, not the one that was archived', async () => {
    const root = await fixtureRoot();

    await archiveCurrentHandoff(root, now, { observeBranch: async () => 'main' });

    const current = await readFile(join(root, 'docs', 'control', 'CURRENT_HANDOFF.md'), 'utf8');
    expect(current).toContain('- Branch: `main`');
    expect(current).not.toContain('- Branch: `codex/atlas-continuity`');
    // The archive itself is untouched: it records what actually happened.
    const archived = await readFile(
      join(root, 'docs', 'control', 'handoffs', 'archived', '2026-07-24-previous-handoff.md'),
      'utf8',
    );
    expect(archived).toContain('- Branch: `codex/atlas-continuity`');
  });

  /**
   * Unreadable is not a licence to invent one. Keeping the archived branch is
   * the last thing known to be true, and a detached `HEAD` names nowhere the
   * work lives.
   */
  it('keeps the archived branch when the worktree cannot be read', async () => {
    const root = await fixtureRoot();

    await archiveCurrentHandoff(root, now, { observeBranch: async () => undefined });

    const current = await readFile(join(root, 'docs', 'control', 'CURRENT_HANDOFF.md'), 'utf8');
    expect(current).toContain('- Branch: `codex/atlas-continuity`');
  });

  it.each(['write', 'rename'])(
    'rolls back only its new archive when current replacement %s fails',
    async (failure) => {
      const root = await fixtureRoot();
      const currentPath = join(root, 'docs', 'control', 'CURRENT_HANDOFF.md');
      const original = await readFile(currentPath, 'utf8');
      const archivePath = join(
        root,
        'docs',
        'control',
        'handoffs',
        'archived',
        '2026-07-24-previous-handoff.md',
      );

      await expect(
        archiveCurrentHandoff(root, now, {
          currentWriteOperations:
            failure === 'write'
              ? { writeFile: async () => Promise.reject(new Error('injected write failure')) }
              : { rename: async () => Promise.reject(new Error('injected rename failure')) },
        }),
      ).rejects.toThrow(new RegExp(`injected ${failure} failure`));
      expect(await readFile(currentPath, 'utf8')).toBe(original);
      await expect(readFile(archivePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await readdir(join(root, 'docs', 'control'))).some((name) => name.includes('.tmp-'))).toBe(
        false,
      );
    },
  );

  it('recovers idempotently when an identical archive exists from an interrupted invocation', async () => {
    const root = await fixtureRoot();
    const currentPath = join(root, 'docs', 'control', 'CURRENT_HANDOFF.md');
    const original = await readFile(currentPath, 'utf8');
    const archivePath = join(
      root,
      'docs',
      'control',
      'handoffs',
      'archived',
      '2026-07-24-previous-handoff.md',
    );
    await writeFile(archivePath, original, 'utf8');

    await expect(archiveCurrentHandoff(root, now)).resolves.toBe(
      join('docs', 'control', 'handoffs', 'archived', '2026-07-24-previous-handoff.md'),
    );
    expect(await readFile(archivePath, 'utf8')).toBe(original);
    expect(await readFile(currentPath, 'utf8')).toContain('**Actor:** Unassigned');
  });

  it('validates the replacement before creating an archive', async () => {
    const root = await fixtureRoot();
    const currentPath = join(root, 'docs', 'control', 'CURRENT_HANDOFF.md');
    const original = (await readFile(currentPath, 'utf8')).replace(
      '- Review status: approved',
      '- Review status: unsafe`review',
    );
    await writeFile(currentPath, original, 'utf8');
    const archivePath = join(
      root,
      'docs',
      'control',
      'handoffs',
      'archived',
      '2026-07-24-previous-handoff.md',
    );

    await expect(archiveCurrentHandoff(root, now)).rejects.toThrow(/unsafe Markdown/i);
    await expect(readFile(archivePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(currentPath, 'utf8')).toBe(original);
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

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import {
  createHandoff,
  type HandoffInput,
  type HandoffObservedState,
  isSafeWorkItemId,
  validateHandoffInput,
} from './handoff.js';
import { atomicWriteHandoff } from './handoff-write.js';
import { WorkQueueSchema } from './schemas.js';

const execFileAsync = promisify(execFile);

interface ParsedArguments {
  id?: string;
  actor: string;
  objective?: string;
  nextAction?: string;
  workItem?: string;
  definitionOfDone: string;
}

const ARGUMENTS: Record<string, keyof ParsedArguments> = {
  '--id': 'id',
  '--actor': 'actor',
  '--objective': 'objective',
  '--next': 'nextAction',
  '--work-item': 'workItem',
  '--definition-of-done': 'definitionOfDone',
};

function parseArguments(args: string[]): ParsedArguments {
  const forwardedArgs = args[0] === '--' ? args.slice(1) : args;
  const parsed: ParsedArguments = {
    actor: 'Codex',
    definitionOfDone: 'The active task acceptance checks pass and the handoff is updated.',
  };
  for (let index = 0; index < forwardedArgs.length; index += 2) {
    const flag = forwardedArgs[index];
    const key = flag ? ARGUMENTS[flag] : undefined;
    if (!key) throw new Error(`unknown argument: ${flag ?? '(missing)'}`);
    const value = forwardedArgs[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${flag} requires a value`);
    }
    parsed[key] = value;
  }
  if (!parsed.id) throw new Error('--id is required');
  if (!parsed.objective) throw new Error('--objective is required');
  if (!parsed.nextAction) throw new Error('--next is required');
  return parsed;
}

function codeField(markdown: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^- ${escaped}: \\x60([^\\x60]+)\\x60\\s*$`, 'im').exec(markdown)?.[1];
}

async function git(root: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  return result.stdout.trimEnd();
}

function sortCodepoints(values: string[]): string[] {
  return values.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

export async function runCreateHandoffCli(
  root: string,
  args: string[],
  writeLine: (line: string) => void = console.log,
  now = new Date(),
): Promise<0 | 1> {
  try {
    if (!Number.isFinite(now.getTime())) throw new Error('handoff time must be valid');
    const parsed = parseArguments(args);
    const controlRoot = join(root, 'docs', 'control');
    const queue = WorkQueueSchema.parse(
      parse(await readFile(join(controlRoot, 'WORK_QUEUE.yaml'), 'utf8')),
    );
    const activeItems = queue.items.filter((item) => item.status === 'in_progress');
    if (activeItems.length !== 1) {
      throw new Error(
        `WORK_QUEUE.yaml must contain exactly one in_progress item; found ${activeItems.length}`,
      );
    }
    const activeWorkItem = activeItems[0]!;
    if (parsed.workItem && !isSafeWorkItemId(parsed.workItem)) {
      throw new Error('--work-item contains unsafe characters');
    }
    if (parsed.workItem && parsed.workItem !== activeWorkItem.id) {
      throw new Error(
        `--work-item must match the single in_progress item ${activeWorkItem.id}`,
      );
    }

    const currentPath = join(controlRoot, 'CURRENT_HANDOFF.md');
    const previous = await readFile(currentPath, 'utf8');
    const [branch, headCommit, status] = await Promise.all([
      git(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
      git(root, ['rev-parse', 'HEAD']),
      git(root, ['status', '--short']),
    ]);
    const previousBase = codeField(previous, 'Base commit');
    const changed = status ? status.split(/\r?\n/).filter(Boolean) : [];
    if (
      !changed.some((entry) =>
        entry.replaceAll('\\', '/').endsWith('docs/control/CURRENT_HANDOFF.md'),
      )
    ) {
      changed.push(' M docs/control/CURRENT_HANDOFF.md');
    }

    const input: HandoffInput = {
      id: parsed.id!,
      actor: parsed.actor,
      objective: parsed.objective!,
      workItem: activeWorkItem.id,
      nextAction: parsed.nextAction!,
      definitionOfDone: parsed.definitionOfDone,
    };
    validateHandoffInput(input);
    const observed: HandoffObservedState = {
      updatedAt: now.toISOString(),
      branch,
      baseCommit: previousBase ?? headCommit,
      headCommit,
      reviewStatus: 'pending independent review',
      filesChanged: sortCodepoints(changed),
      testEvidence: [
        'Test evidence is not inferred by this command; record exact fresh commands before stopping.',
      ],
      databaseActions: ['Database actions: no actions recorded by this command.'],
      hostingActions: ['Hosting actions: no actions recorded by this command.'],
      externalSideEffects: ['No external side effects recorded by this command.'],
      blockers: ['No new blockers recorded by this command.'],
    };

    await atomicWriteHandoff(currentPath, createHandoff(input, observed));
    writeLine(`Created ${relative(root, currentPath).replaceAll('\\', '/')}`);
    return 0;
  } catch (error) {
    writeLine(`ERROR: ${error instanceof Error ? error.message : 'handoff creation failed'}`);
    return 1;
  }
}

async function main(): Promise<void> {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = resolve(moduleDirectory, '../../..');
  process.exitCode = await runCreateHandoffCli(repositoryRoot, process.argv.slice(2));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  await main();
}

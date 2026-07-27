import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';
import {
  createHandoff,
  type HandoffInput,
  type HandoffObservedState,
  isSafeWorkItemId,
  validateSafeHandoffText,
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
  taskChanges: string[];
  evidence: string[];
  databaseActions: string[];
  hostingActions: string[];
  sideEffects: string[];
  blockers: string[];
}

const SCALAR_ARGUMENTS: Record<string, keyof Pick<
  ParsedArguments,
  'id' | 'actor' | 'objective' | 'nextAction' | 'workItem' | 'definitionOfDone'
>> = {
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
    taskChanges: [],
    evidence: [],
    databaseActions: [],
    hostingActions: [],
    sideEffects: [],
    blockers: [],
  };
  for (let index = 0; index < forwardedArgs.length; index += 2) {
    const flag = forwardedArgs[index];
    const value = forwardedArgs[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${flag} requires a value`);
    }
    const scalarKey = flag ? SCALAR_ARGUMENTS[flag] : undefined;
    if (scalarKey) {
      validateSafeHandoffText(flag, value, scalarKey === 'actor' ? 80 : 500);
      parsed[scalarKey] = value;
      continue;
    }
    const repeatable = {
      '--task-change': parsed.taskChanges,
      '--evidence': parsed.evidence,
      '--database-action': parsed.databaseActions,
      '--hosting-action': parsed.hostingActions,
      '--side-effect': parsed.sideEffects,
      '--blocker': parsed.blockers,
    }[flag ?? ''];
    if (!repeatable) throw new Error(`unknown argument: ${flag ?? '(missing)'}`);
    validateSafeHandoffText(flag, value, 1_000);
    repeatable.push(value);
  }
  if (!parsed.id) throw new Error('--id is required');
  if (!parsed.objective) throw new Error('--objective is required');
  if (!parsed.nextAction) throw new Error('--next is required');
  return parsed;
}

const ObservationSummarySchema = z
  .object({
    status: z.enum(['ok', 'drift', 'unknown', 'error']),
    checkedAt: z.string(),
  })
  .passthrough();

const GeneratedObservedStateSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    collectedAt: z.string().refine(
      (value) =>
        Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value,
      'must be a canonical ISO timestamp',
    ),
    provenance: z
      .object({
        collector: z.literal('@atlas/control-schema'),
        mode: z.enum(['injected', 'live-read-only']),
        sources: z.array(z.string()),
      })
      .passthrough(),
    localGit: ObservationSummarySchema,
    github: ObservationSummarySchema,
    supabase: ObservationSummarySchema,
    railwayApi: ObservationSummarySchema,
    railwayOs: ObservationSummarySchema,
    registry: ObservationSummarySchema,
  })
  .passthrough();

interface ObservedActionSummary {
  database: string;
  hosting: string;
}

async function readObservedActionSummary(controlRoot: string): Promise<ObservedActionSummary | undefined> {
  const path = join(controlRoot, 'generated', 'observed-state.json');
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('generated observed-state.json is invalid JSON');
  }
  const parsed = GeneratedObservedStateSummarySchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`generated observed-state.json is invalid: ${parsed.error.message}`);
  }
  const observed = parsed.data;
  const context = `${observed.provenance.mode} at ${observed.collectedAt}`;
  return {
    database: `Observed Supabase status: ${observed.supabase.status} (${context}).`,
    hosting: `Observed Railway API status: ${observed.railwayApi.status}; OS status: ${observed.railwayOs.status} (${context}).`,
  };
}

function codeField(markdown: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^- ${escaped}: \\x60([^\\x60]+)\\x60\\s*$`, 'im').exec(markdown)?.[1];
}

function headingCodeField(markdown: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\*\\*${escaped}:\\*\\* \\x60([^\\x60]+)\\x60\\s*$`, 'im').exec(
    markdown,
  )?.[1];
}

function headingTextField(markdown: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\*\\*${escaped}:\\*\\* (.+?)\\s*$`, 'im').exec(markdown)?.[1];
}

function canonicalTimestamp(value: string | undefined): string | undefined {
  if (
    value &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  ) {
    return value;
  }
  return undefined;
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
    const activeWorkItem = activeItems[0];
    validateSafeHandoffText('active work item', activeWorkItem.id, 200);
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
    const [branch, headCommit, status, observedSummary] = await Promise.all([
      git(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
      git(root, ['rev-parse', 'HEAD']),
      git(root, ['status', '--short']),
      readObservedActionSummary(controlRoot),
    ]);
    const previousBase = codeField(previous, 'Base commit');
    const previousId = headingCodeField(previous, 'Handoff ID');
    const previousStarted = canonicalTimestamp(headingTextField(previous, 'Started'));
    const changed = status ? status.split(/\r?\n/).filter(Boolean) : [];

    const input: HandoffInput = {
      id: parsed.id!,
      actor: parsed.actor,
      objective: parsed.objective!,
      workItem: activeWorkItem.id,
      nextAction: parsed.nextAction!,
      definitionOfDone: parsed.definitionOfDone,
    };
    validateHandoffInput(input);
    const databaseActions =
      parsed.databaseActions.length > 0
        ? [...parsed.databaseActions]
        : ['No external action reported.'];
    const hostingActions =
      parsed.hostingActions.length > 0
        ? [...parsed.hostingActions]
        : ['No external action reported.'];
    if (observedSummary) {
      databaseActions.push(observedSummary.database);
      hostingActions.push(observedSummary.hosting);
    }
    const updatedAt = now.toISOString();
    const observed: HandoffObservedState = {
      startedAt:
        previousId === input.id && previousStarted ? previousStarted : updatedAt,
      updatedAt,
      branch,
      baseCommit: previousBase ?? headCommit,
      headCommit,
      reviewStatus: 'pending independent review',
      taskChangeEvidence:
        parsed.taskChanges.length > 0 ? parsed.taskChanges : ['Not supplied.'],
      workingTreeChanges: sortCodepoints(changed),
      testEvidence: parsed.evidence.length > 0 ? parsed.evidence : ['Not supplied.'],
      databaseActions,
      hostingActions,
      externalSideEffects:
        parsed.sideEffects.length > 0
          ? parsed.sideEffects
          : ['No external action reported.'],
      blockers: parsed.blockers.length > 0 ? parsed.blockers : ['Not supplied.'],
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

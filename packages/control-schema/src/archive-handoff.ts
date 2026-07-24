import { constants } from 'node:fs';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { createHandoff, isSafeHandoffId } from './handoff.js';
import { atomicWriteHandoff } from './handoff-write.js';
import { redactSecrets } from './observed-state.js';
import { WorkQueueSchema } from './schemas.js';

function metadata(markdown: string, label: string, code = false): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wrapper = code ? '\\x60([^\\x60]+)\\x60' : '(.+?)';
  return new RegExp(`^\\*\\*${escaped}:\\*\\*\\s*${wrapper}\\s*$`, 'im').exec(markdown)?.[1];
}

function activeField(markdown: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^- ${escaped}: \\x60([^\\x60]+)\\x60\\s*$`, 'im').exec(markdown)?.[1];
}

function reviewField(markdown: string): string | undefined {
  return /^-\s*Review status:\s*(.+?)\s*$/im.exec(markdown)?.[1];
}

export async function archiveCurrentHandoff(root: string, now: Date): Promise<string> {
  if (!Number.isFinite(now.getTime())) throw new Error('archive time must be valid');
  const controlRoot = join(root, 'docs', 'control');
  const currentPath = join(controlRoot, 'CURRENT_HANDOFF.md');
  const current = await readFile(currentPath, 'utf8');
  if (redactSecrets(current) !== current) {
    throw new Error('current handoff contains secret-like content and cannot be archived');
  }
  const id = metadata(current, 'Handoff ID', true);
  if (!id || !isSafeHandoffId(id)) {
    throw new Error('current handoff has an unsafe handoff ID');
  }

  const queue = WorkQueueSchema.parse(
    parse(await readFile(join(controlRoot, 'WORK_QUEUE.yaml'), 'utf8')),
  );
  const activeItems = queue.items.filter((item) => item.status === 'in_progress');
  if (activeItems.length !== 1) {
    throw new Error(
      `WORK_QUEUE.yaml must contain exactly one in_progress item; found ${activeItems.length}`,
    );
  }

  const date = now.toISOString().slice(0, 10);
  const archiveDirectory = join(controlRoot, 'handoffs', 'archived');
  const archivePath = join(archiveDirectory, `${date}-${id}.md`);
  await mkdir(archiveDirectory, { recursive: true });
  try {
    await copyFile(currentPath, archivePath, constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(
        `refusing to overwrite existing archive ${relative(root, archivePath).replaceAll('\\', '/')}`,
      );
    }
    throw error;
  }

  const activeWorkItem = activeItems[0]!;
  const replacement = createHandoff(
    {
      id: `unassigned-${date}`,
      actor: 'Unassigned',
      objective: 'Preserve a safe takeover point while no model is assigned.',
      workItem: activeWorkItem.id,
      nextAction: 'select a ready work item from WORK_QUEUE.yaml.',
      definitionOfDone: 'A model claims the active work item and creates a new handoff.',
    },
    {
      updatedAt: now.toISOString(),
      branch: activeField(current, 'Branch') ?? 'unknown',
      baseCommit: activeField(current, 'Base commit') ?? 'unknown',
      headCommit: activeField(current, 'Head commit') ?? 'unknown',
      reviewStatus: reviewField(current) ?? 'unknown',
      filesChanged: [],
      testEvidence: ['The prior handoff was archived without altering its contents.'],
      databaseActions: ['None.'],
      hostingActions: ['None.'],
      externalSideEffects: ['Created an immutable repository-local handoff archive.'],
      blockers: ['None recorded in this unassigned placeholder.'],
    },
  );
  await atomicWriteHandoff(currentPath, replacement);
  return relative(root, archivePath);
}

export async function runArchiveHandoffCli(
  root: string,
  writeLine: (line: string) => void = console.log,
  now = new Date(),
): Promise<0 | 1> {
  try {
    const archivePath = await archiveCurrentHandoff(root, now);
    writeLine(`Archived current handoff to ${archivePath.replaceAll('\\', '/')}`);
    return 0;
  } catch (error) {
    writeLine(`ERROR: ${error instanceof Error ? error.message : 'handoff archival failed'}`);
    return 1;
  }
}

async function main(): Promise<void> {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = resolve(moduleDirectory, '../../..');
  process.exitCode = await runArchiveHandoffCli(repositoryRoot);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  await main();
}

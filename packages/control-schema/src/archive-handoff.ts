import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parse } from 'yaml';
import { createHandoff, isSafeHandoffId } from './handoff.js';
import {
  atomicWriteHandoff,
  type AtomicWriteOperations,
} from './handoff-write.js';
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

const execFileAsync = promisify(execFile);

/**
 * The branch the worktree is actually on.
 *
 * The replacement handoff used to copy the archived one's branch forward, and
 * that is how the takeover point this function exists to create came to be one
 * that fails verification. After a merge the archived work sits on a branch
 * that is no longer where anything happens, `control:verify` compares the
 * recorded branch against the authoritative one, and blocks — so the artifact
 * whose whole purpose is "a safe place for the next model to start" was
 * reliably unsafe, and every session after a merge opened on a blocking
 * finding that meant nothing. A blocking finding that fires in a correct state
 * is worse than no finding: it is the thing that teaches people to skip the
 * check that would have caught a real one.
 */
async function defaultObserveBranch(root: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: root,
      windowsHide: true,
      encoding: 'utf8',
    });
    const branch = stdout.trim();
    // A detached HEAD is not a branch, and naming it `HEAD` would be a claim
    // about where the work lives that is not true of anywhere.
    return branch === '' || branch === 'HEAD' ? undefined : branch;
  } catch {
    return undefined;
  }
}

export interface ArchiveHandoffDependencies {
  currentWriteOperations?: AtomicWriteOperations;
  /**
   * Injected so the tests need no git repository. Returning `undefined` means
   * the worktree could not be read, and the archived branch is kept — the last
   * thing known to be true, rather than a guess.
   */
  observeBranch?: (root: string) => Promise<string | undefined>;
  writeArchive?: (
    path: string,
    content: string,
    options: { encoding: 'utf8'; flag: 'wx' },
  ) => Promise<unknown>;
  removeArchive?: (path: string, options: { force: true }) => Promise<unknown>;
}

export async function archiveCurrentHandoff(
  root: string,
  now: Date,
  dependencies: ArchiveHandoffDependencies = {},
): Promise<string> {
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

  const observedBranch = await (dependencies.observeBranch ?? defaultObserveBranch)(root);

  const date = now.toISOString().slice(0, 10);
  const archiveDirectory = join(controlRoot, 'handoffs', 'archived');
  const archivePath = join(archiveDirectory, `${date}-${id}.md`);
  const activeWorkItem = activeItems[0];
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
      startedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      /*
       * Where the next model would actually be standing, not where the work
       * that just finished was done. Falls back to the archived branch only
       * when the worktree cannot be read.
       */
      branch: observedBranch ?? activeField(current, 'Branch') ?? 'unknown',
      baseCommit: activeField(current, 'Base commit') ?? 'unknown',
      headCommit: activeField(current, 'Head commit') ?? 'unknown',
      reviewStatus: reviewField(current) ?? 'unknown',
      taskChangeEvidence: ['The prior current handoff was archived byte-for-byte.'],
      workingTreeChanges: [],
      testEvidence: ['The prior handoff was archived without altering its contents.'],
      databaseActions: ['No external action reported.'],
      hostingActions: ['No external action reported.'],
      externalSideEffects: ['Created an immutable repository-local handoff archive.'],
      blockers: ['Not supplied.'],
    },
  );

  const writeArchive = dependencies.writeArchive ?? (async (path, content, options) => {
    await writeFile(path, content, options);
  });
  const removeArchive = dependencies.removeArchive ?? (async (path, options) => {
    await rm(path, options);
  });
  await mkdir(archiveDirectory, { recursive: true });
  let createdArchive = false;
  try {
    await writeArchive(archivePath, current, { encoding: 'utf8', flag: 'wx' });
    createdArchive = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existing = await readFile(archivePath, 'utf8');
    if (existing !== current) {
      throw new Error(
        `refusing to overwrite existing archive ${relative(root, archivePath).replaceAll('\\', '/')}`,
        { cause: error },
      );
    }
  }

  try {
    await atomicWriteHandoff(
      currentPath,
      replacement,
      dependencies.currentWriteOperations,
    );
  } catch (replacementError) {
    if (createdArchive) {
      try {
        await removeArchive(archivePath, { force: true });
      } catch (rollbackError) {
        // Both failures stay in `errors`; `cause` is the rollback failure
        // this block caught, with the original replacement failure first in
        // the list so neither is lost.
        throw new AggregateError(
          [replacementError, rollbackError],
          'current handoff replacement failed and the identical archive rollback failed; retry is safe',
          { cause: rollbackError },
        );
      }
    }
    throw replacementError;
  }
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

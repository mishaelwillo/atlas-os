import { execFile } from 'node:child_process';
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parse } from 'yaml';
import { loadRegionPacks } from './regions.js';
import { assertRepositoryResearchIntegrity } from './research.js';
import { assertRepositorySpecificationIntegrity } from './specifications.js';
import { EnvironmentFileSchema, WorkQueueSchema, type Finding, type WorkQueue } from './schemas.js';

const SEVERITY_ORDER = { blocking: 0, warning: 1, info: 2 } as const;
const DOCUMENT_SECRET_PATTERN =
  /\bgho_|\bgithub_pat_|\bsb_secret_|\bsk-[A-Za-z0-9_-]+|\bpostgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@|-----BEGIN/g;
const APPROVED_METADATA_ONLY_PATHS = new Set([
  'docs/control/CURRENT_HANDOFF.md',
  'docs/control/CURRENT_STATE.md',
]);
const SPECIFICATION_OWNERS = new Map([
  ['P1-DEPLOY-001', 'docs/control/DEPLOYMENT_RUNBOOK.md'],
  ['P2A-CONTROL-001', 'docs/control/CONTINUITY_DESIGN.md'],
  ['P2A-CAPABILITIES-001', 'docs/specs/p2/README.md'],
  ['P2A-MEMORY-001', 'docs/specs/p2/intelligence-foundation.md'],
  ['P2B-FACTORY-001', 'docs/specs/p2/website-factory.md'],
  ['P2C-REVENUE-001', 'docs/specs/p2/revenue-pilot.md'],
]);
const execFileAsync = promisify(execFile);

export interface StaticGitObservation {
  branch: string;
  headSha: string;
  boundaryExists: boolean;
  boundaryIsAncestor: boolean;
  changedPaths: string[];
}

export interface VerifyStaticOptions {
  observeGit?: (
    root: string,
    boundaryCommit: string,
  ) => Promise<StaticGitObservation>;
}

function compareCodepoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    }),
  );
  return nested.flat();
}

function blocking(code: string, path: string, message: string): Finding {
  return { severity: 'blocking', code, path, message };
}

function sortFindings(findings: Finding[]): Finding[] {
  return findings.sort(
    (left, right) =>
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
      compareCodepoints(left.code, right.code) ||
      compareCodepoints(left.path, right.path) ||
      compareCodepoints(left.message, right.message),
  );
}

function indexedRepositoryPaths(index: string): string[] {
  return [...index.matchAll(/`path:([^`\r\n]+)`/g)].map((match) => match[1]);
}

function pathIsWithin(base: string, target: string): boolean {
  const relativePath = relative(base, target);
  return (
    relativePath === '' ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath))
  );
}

function structuredHandoffWorkItem(handoff: string): string | undefined {
  return /^\s*-\s*Work item:\s*`([^`]+)`\s*$/im.exec(handoff)?.[1];
}

function structuredHandoffField(handoff: string, field: string): string | undefined {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\s*-\\s*${escaped}:\\s*\`([^\`]+)\`\\s*$`, 'im').exec(
    handoff,
  )?.[1];
}

function structuredHandoffNextAction(handoff: string): string | undefined {
  const lines = handoff.split(/\r?\n/);
  const start = lines.findIndex(
    (line) => line.trim().toLowerCase() === '## next exact action',
  );
  if (start < 0) return undefined;
  const end = lines.findIndex(
    (line, index) => index > start && line.trim().startsWith('## '),
  );
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
}

function taskReferences(action: string | undefined): string[] {
  if (!action) return [];
  return [
    ...new Set(
      [...action.matchAll(/\bTask\s+(\d+)\b/gi)].map((match) => match[1]),
    ),
  ];
}

async function parseYamlFile(path: string): Promise<unknown> {
  return parse(await readFile(path, 'utf8'));
}

async function defaultObserveGit(
  root: string,
  boundaryCommit: string,
): Promise<StaticGitObservation> {
  const run = async (args: string[]) => {
    try {
      const result = await execFileAsync('git', args, {
        cwd: root,
        windowsHide: true,
        encoding: 'utf8',
      });
      return { exitCode: 0, stdout: result.stdout.trim() };
    } catch (error) {
      const result = error as Error & { code?: number; stdout?: string };
      return {
        exitCode: typeof result.code === 'number' ? result.code : 1,
        stdout: result.stdout?.trim() ?? '',
      };
    }
  };
  const [branch, head, exists, ancestor, changed] = await Promise.all([
    run(['branch', '--show-current']),
    run(['rev-parse', 'HEAD']),
    run(['cat-file', '-e', `${boundaryCommit}^{commit}`]),
    run(['merge-base', '--is-ancestor', boundaryCommit, 'HEAD']),
    run(['diff', '--name-only', `${boundaryCommit}..HEAD`]),
  ]);
  return {
    branch: branch.stdout,
    headSha: head.stdout,
    boundaryExists: exists.exitCode === 0,
    boundaryIsAncestor: ancestor.exitCode === 0,
    changedPaths:
      changed.exitCode === 0
        ? changed.stdout.split(/\r?\n/).filter(Boolean).map((path) => path.replaceAll('\\', '/'))
        : [],
  };
}

export async function verifyStatic(
  root: string,
  options: VerifyStaticOptions = {},
): Promise<Finding[]> {
  const controlRoot = join(root, 'docs', 'control');
  const environmentPath = join(controlRoot, 'ENVIRONMENTS.yaml');
  const queuePath = join(controlRoot, 'WORK_QUEUE.yaml');
  const handoffPath = join(controlRoot, 'CURRENT_HANDOFF.md');
  const indexPath = join(controlRoot, 'CONTROL_INDEX.md');
  const regionsRoot = join(controlRoot, 'regions');
  const researchLedgerPath = join(controlRoot, 'RESEARCH_LEDGER.yaml');
  const candidatesPath = join(controlRoot, 'CAPABILITY_CANDIDATES.yaml');
  const findings: Finding[] = [];

  let queue: WorkQueue | undefined;
  try {
    EnvironmentFileSchema.parse(await parseYamlFile(environmentPath));
  } catch (error) {
    findings.push(
      blocking(
        'control.environment_invalid',
        relative(root, environmentPath),
        error instanceof Error ? error.message : 'invalid environment registry',
      ),
    );
  }

  if ((await pathExists(researchLedgerPath)) || (await pathExists(candidatesPath))) {
    try {
      await assertRepositoryResearchIntegrity(root);
    } catch (error) {
      findings.push(
        blocking(
          'control.research_invalid',
          relative(root, researchLedgerPath),
          error instanceof Error ? error.message : 'invalid research control files',
        ),
      );
    }
  }

  if (await pathExists(join(root, 'docs', 'specs', 'p2', 'README.md'))) {
    try {
      await assertRepositorySpecificationIntegrity(root);
    } catch (error) {
      findings.push(
        blocking(
          'control.specifications_invalid',
          'docs/specs/p2',
          error instanceof Error ? error.message : 'invalid P2 specifications',
        ),
      );
    }
  }

  try {
    queue = WorkQueueSchema.parse(await parseYamlFile(queuePath));
  } catch (error) {
    findings.push(
      blocking(
        'control.work_queue_invalid',
        relative(root, queuePath),
        error instanceof Error ? error.message : 'invalid work queue',
      ),
    );
  }

  try {
    const regionFiles = (await readdir(regionsRoot))
      .filter((fileName) => fileName.endsWith('.yaml'))
      .sort(compareCodepoints);
    if (regionFiles.length === 0) {
      throw new Error('no regional YAML packs found');
    }
    await loadRegionPacks(regionsRoot, regionFiles);
  } catch (error) {
    findings.push(
      blocking(
        'control.region_packs_invalid',
        relative(root, regionsRoot),
        error instanceof Error ? error.message : 'invalid regional packs',
      ),
    );
  }

  const handoff = await readFile(handoffPath, 'utf8').catch((error: unknown) => {
    findings.push(
      blocking(
        'control.handoff_unreadable',
        relative(root, handoffPath),
        error instanceof Error ? error.message : 'cannot read current handoff',
      ),
    );
    return '';
  });
  const recordedBranch = structuredHandoffField(handoff, 'Branch');
  const recordedBoundary = structuredHandoffField(handoff, 'Head commit');
  if (recordedBranch && recordedBoundary) {
    try {
      const git = await (options.observeGit ?? defaultObserveGit)(root, recordedBoundary);
      if (git.branch !== recordedBranch) {
        findings.push(
          blocking(
            'control.handoff_branch_mismatch',
            relative(root, handoffPath),
            `handoff branch ${recordedBranch} differs from checked-out branch ${git.branch || 'unknown'}`,
          ),
        );
      }
      if (!git.boundaryExists) {
        findings.push(
          blocking(
            'control.handoff_commit_missing',
            relative(root, handoffPath),
            `recorded code-boundary commit ${recordedBoundary} does not exist`,
          ),
        );
      } else if (!git.boundaryIsAncestor) {
        findings.push(
          blocking(
            'control.handoff_commit_not_ancestor',
            relative(root, handoffPath),
            `recorded code-boundary commit ${recordedBoundary} is not an ancestor of HEAD`,
          ),
        );
      } else {
        const disallowed = git.changedPaths
          .map((path) => path.replaceAll('\\', '/'))
          .filter((path) => !APPROVED_METADATA_ONLY_PATHS.has(path))
          .sort(compareCodepoints);
        if (disallowed.length > 0) {
          findings.push(
            blocking(
              'control.handoff_boundary_changed',
              relative(root, handoffPath),
              `post-boundary changes are not metadata-only: ${disallowed.join(', ')}`,
            ),
          );
        }
      }
    } catch (error) {
      findings.push(
        blocking(
          'control.handoff_git_unavailable',
          relative(root, handoffPath),
          error instanceof Error ? error.message : 'Git takeover authority is unavailable',
        ),
      );
    }
  }
  const index = await readFile(indexPath, 'utf8').catch((error: unknown) => {
    findings.push(
      blocking(
        'control.index_unreadable',
        relative(root, indexPath),
        error instanceof Error ? error.message : 'cannot read control index',
      ),
    );
    return '';
  });

  if (queue) {
    const activeItems = queue.items.filter((item) => item.status === 'in_progress');
    if (activeItems.length !== 1) {
      findings.push(
        blocking(
          'control.active_work_count',
          relative(root, queuePath),
          `expected exactly one in_progress work item, found ${activeItems.length}`,
        ),
      );
    } else {
      const activeItem = activeItems[0];
      if (structuredHandoffWorkItem(handoff) !== activeItem.id) {
        findings.push(
          blocking(
            'control.handoff_active_work',
            relative(root, handoffPath),
            `handoff does not mention active work item ${activeItem.id}`,
          ),
        );
      }

      const queueTasks = taskReferences(activeItem.next_action);
      const handoffTasks = taskReferences(structuredHandoffNextAction(handoff));
      if (
        (queueTasks.length > 0 || handoffTasks.length > 0) &&
        JSON.stringify(queueTasks) !== JSON.stringify(handoffTasks)
      ) {
        findings.push(
          blocking(
            'control.handoff_next_action',
            relative(root, queuePath),
            `active work item ${activeItem.id} next_action contradicts CURRENT_HANDOFF.md`,
          ),
        );
      }
    }

    await Promise.all(
      queue.items.map(async (item) => {
        const docsRoot = join(root, 'docs');
        const specificationPath = resolve(root, item.specification);
        const repositoryPath = item.specification.replaceAll('\\', '/');
        if (
          isAbsolute(item.specification) ||
          !pathIsWithin(docsRoot, specificationPath)
        ) {
          findings.push(
            blocking(
              'control.specification_path_unsafe',
              repositoryPath,
              `specification for ${item.id} must be a repository-relative path inside docs`,
            ),
          );
          return;
        }
        const owner = SPECIFICATION_OWNERS.get(item.id);
        if (owner && repositoryPath !== owner) {
          findings.push(
            blocking(
              'control.specification_owner_mismatch',
              relative(root, queuePath),
              `work item ${item.id} must resolve to owning specification ${owner}`,
            ),
          );
        }
        if (!(await pathExists(specificationPath))) {
          findings.push(
            blocking(
              'control.specification_missing',
              relative(root, specificationPath),
              `specification for ${item.id} does not exist`,
            ),
          );
        }
      }),
    );
  }

  await Promise.all(
    indexedRepositoryPaths(index).map(async (indexedPath) => {
      const absolutePath = resolve(root, indexedPath);
      if (isAbsolute(indexedPath) || !pathIsWithin(root, absolutePath)) {
        findings.push(
          blocking(
            'control.index_path_unsafe',
            indexedPath,
            'path named in CONTROL_INDEX.md must be repository-root-relative',
          ),
        );
        return;
      }
      if (!(await pathExists(absolutePath))) {
        findings.push(
          blocking(
            'control.index_path_missing',
            relative(root, absolutePath),
            'path named in CONTROL_INDEX.md does not exist',
          ),
        );
      }
    }),
  );

  if (await pathExists(controlRoot)) {
    for (const file of await listFiles(controlRoot)) {
      const content = await readFile(file, 'utf8');
      if (DOCUMENT_SECRET_PATTERN.test(content)) {
        findings.push(
          blocking(
            'control.secret_value',
            relative(root, file),
            'prohibited secret-like value',
          ),
        );
      }
      DOCUMENT_SECRET_PATTERN.lastIndex = 0;
    }
  }

  return sortFindings(findings);
}

function formatFinding(finding: Finding): string {
  const repositoryPath = finding.path.replaceAll('\\', '/');
  return `${finding.severity.toUpperCase()} ${finding.code} ${repositoryPath}: ${finding.message}`;
}

export async function runStaticVerificationCli(
  root: string,
  writeLine: (line: string) => void = console.log,
): Promise<0 | 1> {
  const findings = await verifyStatic(root);
  findings.forEach((finding) => writeLine(formatFinding(finding)));
  return findings.some((finding) => finding.severity === 'blocking') ? 1 : 0;
}

async function main(): Promise<void> {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = resolve(moduleDirectory, '../../..');
  process.exitCode = await runStaticVerificationCli(repositoryRoot);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  await main();
}

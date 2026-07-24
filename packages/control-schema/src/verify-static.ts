import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { loadRegionPacks } from './regions.js';
import { EnvironmentFileSchema, WorkQueueSchema, type Finding, type WorkQueue } from './schemas.js';

const SEVERITY_ORDER = { blocking: 0, warning: 1, info: 2 } as const;
const DOCUMENT_SECRET_PATTERN =
  /\bgho_|\bgithub_pat_|\bsb_secret_|\bsk-[A-Za-z0-9_-]+|\bpostgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@|-----BEGIN/g;

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

export async function verifyStatic(root: string): Promise<Finding[]> {
  const controlRoot = join(root, 'docs', 'control');
  const environmentPath = join(controlRoot, 'ENVIRONMENTS.yaml');
  const queuePath = join(controlRoot, 'WORK_QUEUE.yaml');
  const handoffPath = join(controlRoot, 'CURRENT_HANDOFF.md');
  const indexPath = join(controlRoot, 'CONTROL_INDEX.md');
  const regionsRoot = join(controlRoot, 'regions');
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
        const specificationPath = resolve(controlRoot, item.specification);
        if (isAbsolute(item.specification) || !pathIsWithin(controlRoot, specificationPath)) {
          findings.push(
            blocking(
              'control.specification_path_unsafe',
              `docs/control/${item.specification.replaceAll('\\', '/')}`,
              `specification for ${item.id} must be relative to docs/control`,
            ),
          );
          return;
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

import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { EnvironmentFileSchema, WorkQueueSchema, type Finding, type WorkQueue } from './schemas.js';

const SEVERITY_ORDER = { blocking: 0, warning: 1, info: 2 } as const;
const DOCUMENT_SECRET_PATTERN =
  /gho_|github_pat_|sb_secret_|sk-[A-Za-z0-9_-]+|postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@|-----BEGIN/g;

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
      left.code.localeCompare(right.code) ||
      left.path.localeCompare(right.path) ||
      left.message.localeCompare(right.message),
  );
}

function indexedControlPaths(index: string): string[] {
  return [...index.matchAll(/`([^`\r\n]+\.(?:md|ya?ml|json))`/gi)].map((match) => match[1]);
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
    } else if (!handoff.includes(activeItems[0].id)) {
      findings.push(
        blocking(
          'control.handoff_active_work',
          relative(root, handoffPath),
          `handoff does not mention active work item ${activeItems[0].id}`,
        ),
      );
    }

    await Promise.all(
      queue.items.map(async (item) => {
        const specificationPath = join(controlRoot, item.specification);
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
    indexedControlPaths(index).map(async (indexedPath) => {
      const absolutePath = join(controlRoot, indexedPath);
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
  return `${finding.severity.toUpperCase()} ${finding.code} ${finding.path}: ${finding.message}`;
}

async function main(): Promise<void> {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = resolve(moduleDirectory, '../../..');
  const findings = await verifyStatic(repositoryRoot);
  findings.forEach((finding) => console.log(formatFinding(finding)));
  if (findings.some((finding) => finding.severity === 'blocking')) {
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  await main();
}

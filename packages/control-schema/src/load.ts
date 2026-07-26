import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import {
  EnvironmentFileSchema,
  WorkQueueSchema,
  type EnvironmentFile,
  type WorkQueue,
} from './schemas.js';

export interface ControlFiles {
  environments: EnvironmentFile;
  workQueue: WorkQueue;
  currentHandoff: string;
  controlIndex: string;
}

export async function loadControlFiles(root: string): Promise<ControlFiles> {
  const controlRoot = join(root, 'docs', 'control');
  const [environmentYaml, workQueueYaml, currentHandoff, controlIndex] = await Promise.all([
    readFile(join(controlRoot, 'ENVIRONMENTS.yaml'), 'utf8'),
    readFile(join(controlRoot, 'WORK_QUEUE.yaml'), 'utf8'),
    readFile(join(controlRoot, 'CURRENT_HANDOFF.md'), 'utf8'),
    readFile(join(controlRoot, 'CONTROL_INDEX.md'), 'utf8'),
  ]);

  return {
    environments: EnvironmentFileSchema.parse(parse(environmentYaml)),
    workQueue: WorkQueueSchema.parse(parse(workQueueYaml)),
    currentHandoff,
    controlIndex,
  };
}

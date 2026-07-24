import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface AtomicWriteOperations {
  mkdir?: (path: string, options: { recursive: true }) => Promise<unknown>;
  writeFile?: (
    path: string,
    content: string,
    options: { encoding: 'utf8'; flag: 'wx' },
  ) => Promise<unknown>;
  rename?: (from: string, to: string) => Promise<unknown>;
  rm?: (path: string, options: { force: true }) => Promise<unknown>;
}

export async function atomicWriteHandoff(
  path: string,
  content: string,
  operations: AtomicWriteOperations = {},
): Promise<void> {
  const makeDirectory = operations.mkdir ?? mkdir;
  const writeTemporary = operations.writeFile ?? writeFile;
  const replace = operations.rename ?? rename;
  const removeTemporary = operations.rm ?? rm;
  await makeDirectory(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeTemporary(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
    await replace(temporaryPath, path);
  } finally {
    await removeTemporary(temporaryPath, { force: true }).catch(() => undefined);
  }
}

import { describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { assertRepositorySpecificationIntegrity } from './specifications.js';

describe('P2 specification integrity', () => {
  test('the repository specification set is complete and evidence-backed', async () => {
    await expect(
      assertRepositorySpecificationIntegrity(fileURLToPath(new URL('../../..', import.meta.url))),
    ).resolves.toBeUndefined();
  });
});

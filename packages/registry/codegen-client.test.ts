import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * The generated client must never call the global fetch with the client as the
 * receiver. Browsers reject that with:
 *   TypeError: 'fetch' called on an object that does not implement interface Window
 * which broke Mission Control's status poll in production.
 */
const codegenSource = readFileSync(resolve(__dirname, 'codegen.ts'), 'utf8');
const generatedClient = readFileSync(
  resolve(__dirname, '../client/src/client.gen.ts'),
  'utf8',
);

describe('generated client fetch binding', () => {
  test.each([
    ['codegen template', codegenSource],
    ['generated client', generatedClient],
  ])('%s does not default fetchImpl to an unbound global fetch', (_name, source) => {
    expect(source).not.toMatch(/opts\.fetchImpl\s*\?\?\s*fetch\s*;/);
  });

  test.each([
    ['codegen template', codegenSource],
    ['generated client', generatedClient],
  ])('%s binds the default fetch to globalThis', (_name, source) => {
    expect(source).toMatch(/opts\.fetchImpl\s*\?\?\s*fetch\.bind\(globalThis\)/);
  });

  /**
   * Behavioural proof: a getter that throws unless invoked with the global as
   * receiver reproduces the browser's rule. Calling it as a method of another
   * object must not be how the client invokes it.
   */
  test('a bound fetch survives being called as an object property', async () => {
    const globalLike: Record<string, unknown> = {};
    function strictFetch(this: unknown): Promise<string> {
      if (this !== globalLike) {
        throw new TypeError(
          "'fetch' called on an object that does not implement interface Window",
        );
      }
      return Promise.resolve('ok');
    }
    globalLike.fetch = strictFetch;

    const holderUnbound = { fetchImpl: strictFetch as () => Promise<string> };
    expect(() => holderUnbound.fetchImpl()).toThrow(/does not implement interface Window/);

    const holderBound = {
      fetchImpl: (strictFetch as () => Promise<string>).bind(globalLike),
    };
    await expect(holderBound.fetchImpl()).resolves.toBe('ok');
  });
});

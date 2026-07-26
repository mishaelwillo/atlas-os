import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  EnvironmentFileSchema,
  WorkQueueSchema,
  loadControlFiles,
  resolveRegionPack,
} from './index.js';

const packageRoot = resolve(import.meta.dirname, '..');

describe('@atlas/control-schema public entry point', () => {
  test('exports prior schema and loader APIs plus regional resolution', () => {
    expect(EnvironmentFileSchema).toBeDefined();
    expect(WorkQueueSchema).toBeDefined();
    expect(loadControlFiles).toBeTypeOf('function');
    expect(resolveRegionPack).toBeTypeOf('function');
  });

  test('publishes the canonical built entry through main, types, and exports', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(packageRoot, 'package.json'), 'utf8'),
    ) as {
      main?: string;
      types?: string;
      exports?: Record<string, unknown>;
    };

    expect(manifest.main).toBe('./dist/index.js');
    expect(manifest.types).toBe('./dist/index.d.ts');
    expect(manifest.exports).toEqual({
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.js',
      },
    });
  });
});

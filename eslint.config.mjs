// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * Workspace lint gate.
 *
 * Type-aware rules are enabled deliberately. The cheap syntactic rules would
 * not have caught anything that has actually gone wrong here; the rules that
 * earn their keep in a Fastify + pg codebase are the ones that need types —
 * above all `no-floating-promises`, since an un-awaited query silently skips
 * the work and the handler returns as if it succeeded.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.gen.ts', // generated from the registry; fix the codegen instead
      'docs/**',
      '**/coverage/**',
      '.worktrees/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      // An un-awaited promise is the highest-value catch in this codebase.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // Unused code is usually a leftover from an incomplete edit.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // The codebase is strict TypeScript; `any` should be a deliberate choice.
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'off',
      /*
       * Off deliberately, not because it is wrong. It fires on String() over
       * pg rows and JSONB payloads, which are typed `unknown` even though the
       * values are strings at runtime (uuid columns, schema-validated inputs).
       * The honest fix is typed row accessors rather than 15 suppressions;
       * until that exists this would be permanent noise.
       */
      '@typescript-eslint/no-base-to-string': 'off',
      /*
       * Off: async without await is used deliberately here to satisfy the
       * CapabilityHandler and ApprovalDispatcher signatures, and in test fakes
       * implementing async interfaces.
       */
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    /*
     * Tests and build configs sit outside their packages' build tsconfigs, so
     * type-aware rules cannot resolve them. They keep syntactic linting;
     * type-aware coverage stays where it matters, on production source.
     */
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.config.ts',
      'packages/registry/codegen.ts',
      'packages/registry/catalog.ts',
    ],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // Browser code: node globals do not apply, and JSX needs the DOM.
    files: ['apps/os/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    /*
     * Tests deliberately construct malformed input and reach into internals to
     * prove failure paths, so the strictest assertion rules would fight them.
     * Correctness rules stay on.
     */
    files: ['**/*.test.ts', '**/*.test.tsx', '**/test/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    // Plain-JS build scripts predate the TS setup; CommonJS require is correct
    // there, so the ESM-only rule does not apply.
    files: ['**/*.cjs', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);

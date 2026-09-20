import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Shared flat config. Each workspace package re-exports this so `turbo run lint`
 * resolves the same rules regardless of which directory eslint is invoked from.
 *
 * Type-aware linting (and the dependency-direction boundary rule promised in
 * AGENTS.md §5) land once there is real code to point them at.
 */
export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/.next/**', '**/.turbo/**', '**/coverage/**', '**/node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    rules: {
      // AGENTS.md §5: real types, parse at boundaries — never assert past them.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
);

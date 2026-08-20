import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.turbo/**',
      'pnpm-lock.yaml',
      'pnpm-lock 2.yaml',
      'apps/console/**',
      // WHY: Vitest config is runner wiring, not kernel runtime, and is outside package tsconfigs.
      '**/vitest.config.ts',
      // WHY: example/fixture trees are sample input, not production modules.
      '**/examples/**',
      '**/fixtures/**',
      // WHY: these trees sit outside the emit tsconfig (rootDir src / SHA-protected include).
      // Production src is still linted; tests still run in verify:unit.
      'packages/auto-logging-config/tests/**',
      'packages/common-build-system/tests/**',
      'packages/connector-webhook/tests/**',
      'packages/dynamic-documentation/tests/**',
      'packages/metrics-collection/tests/**',
      'packages/security-config-secrets/test/**',
      'scripts/**/*.ts',
    ],
  },
  eslint.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      globals: globals.node,
      sourceType: 'module',
      ecmaVersion: 2022,
    },
    rules: {
      'no-fallthrough': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.node,
    },
    rules: {
      'no-fallthrough': 'error',
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        {
          checksVoidReturn: {
            properties: false,
          },
        },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      'prefer-const': 'off',
      'no-useless-escape': 'off',
      'require-yield': 'off',
    },
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
);

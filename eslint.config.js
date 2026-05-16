/**
 * ESLint v9 flat config.
 *
 * Replaces the old `.eslintrc.json` (no longer supported by ESLint 9).
 * Covers `src/**` (Node/TypeScript) and `tests/**` only — the Nuxt `web/` app
 * carries its own toolchain and is intentionally out of scope here.
 */

const js = require('@eslint/js');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const globals = require('globals');

const tsRecommended = tsPlugin.configs.recommended.rules ?? {};

module.exports = [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'web/**',
      'python/**',
      'coverage/**',
      'src/apps/api/public/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsRecommended,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
      /**
       * TypeScript already enforces these. Leaving `no-undef` on flags valid
       * type-only globals like `NodeJS.ErrnoException` as undefined.
       */
      'no-undef': 'off',
      /** Tests legitimately use `any` for stubs and ignore unused fixtures. */
    },
  },
  {
    files: ['tests/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
];

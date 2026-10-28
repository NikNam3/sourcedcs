// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['node_modules/', 'web/js/', 'data/', 'extraction/', 'prototype/'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // 0 kt, 0 % and DI 0 are valid values: a number is never tested for truthiness.
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        { allowString: false, allowNumber: false, allowNullableObject: false },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      // node:test runs test() and describe() itself; their promises need no await.
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            { from: 'package', package: 'node:test', name: ['test', 'describe', 'it', 'suite'] },
          ],
        },
      ],
    },
  },
  {
    // src/core/ runs in the browser and in node --test with chart data passed in: no Node, no DOM,
    // no I/O. The shared tsconfig has Node types, so typecheck cannot catch these; lint does.
    files: ['src/core/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['node:*'], message: 'src/core/ has no Node imports: pass the data in.' }] },
      ],
      'no-restricted-globals': [
        'error',
        ...['fetch', 'document', 'window', 'localStorage', 'process'].map((name) => ({
          name,
          message: 'src/core/ has no DOM, no I/O and no process: pass the data in.',
        })),
      ],
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);

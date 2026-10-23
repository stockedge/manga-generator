import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/*',
      '!cli/',
      '!src/',
      '!tests/',
      '!cli/**',
      '!src/**',
      '!tests/**',
      '!eslint.config.mjs',
    ],
  },
  {
    files: [
      'cli/**/*.mjs',
      'src/**/*.mjs',
      'tests/**/*.mjs',
      'eslint.config.mjs',
    ],
    languageOptions: { globals: globals.node },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
    },
  },
];

import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '.agents/**',
      '.wrangler/**',
      'coverage/**',
      'dist/**',
      'eslint.config.js',
      'node_modules/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      complexity: ['error', 20],
      'max-depth': ['error', 3],
      'max-nested-callbacks': ['error', 4],
      'max-statements': ['error', 50],
      'no-multiple-empty-lines': ['error', { max: 1, maxBOF: 0, maxEOF: 0 }],
      'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: 'return' },
        {
          blankLine: 'always',
          prev: '*',
          next: ['if', 'for', 'while', 'switch', 'try'],
        },
        { blankLine: 'always', prev: ['const', 'let', 'var'], next: '*' },
        {
          blankLine: 'any',
          prev: ['const', 'let', 'var'],
          next: ['const', 'let', 'var'],
        },
      ],
    },
  },
  {
    files: ['src/web/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        AbortSignal: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
      },
    },
  },
  prettier,
);

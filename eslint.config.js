import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist', '**/node_modules', '.data', '.regent', 'test-results', 'playwright-report', 'coverage'] },
  {
    files: ['**/*.{ts,tsx,js}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2023, globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'separate-type-imports' }],
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
      // The API and CLI run TypeScript under Node's type stripping, which
      // cannot emit runtime code for these constructs.
      'no-restricted-syntax': [
        'error',
        { selector: 'TSEnumDeclaration', message: 'No enum: Node type stripping cannot run it.' },
        { selector: 'TSModuleDeclaration[kind!="global"]', message: 'No namespace: Node type stripping cannot run it.' },
        { selector: 'TSParameterProperty', message: 'No constructor parameter properties: assign in the body.' },
      ],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // The engine is deterministic: no clock, no randomness, no I/O, no DOM.
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'document', message: 'The engine is UI-independent.' },
        { name: 'window', message: 'The engine is UI-independent.' },
        { name: 'fetch', message: 'The engine makes no network requests.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'The engine never reads the clock: same input, same result.' },
        { object: 'Math', property: 'random', message: 'The engine is deterministic.' },
      ],
    },
  },
  {
    // The console displays verdicts; it must never compute them.
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { paths: [{ name: '@regent/core', message: 'The web console may import engine TYPES only (import type). Verdicts come from the API.', allowTypeImports: true }] },
      ],
    },
  },
  {
    files: ['**/test/**/*.ts', 'tests/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
)

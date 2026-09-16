// Flat ESLint config — the CI gate. Starts pragmatic on an existing 18k-line
// codebase: correctness rules are errors; style-ish rules stay warnings so the
// gate catches real bugs (undefined vars, dupe keys, bad hooks) without a
// thousand-line cleanup as a precondition. Tighten over time.
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'supabase/functions/**'] }, // Deno TS lives elsewhere
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}', '*.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.es2021 },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // v6's React-Compiler diagnostics flag long-standing working patterns
      // (setState-in-effect, ids from Date.now() during render, closure-hoisted
      // helpers). Keep them visible as WARNINGS — a modernization backlog, not a
      // merge blocker. rules-of-hooks stays a hard error: that one is real bugs.
      ...Object.fromEntries(
        Object.keys(reactHooks.configs.recommended.rules)
          .filter((r) => r !== 'react-hooks/rules-of-hooks')
          .map((r) => [r, 'warn'])
      ),
      'react-hooks/rules-of-hooks': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^[A-Z]' }], // ^[A-Z]: JSX components read as unused by core eslint
      'no-empty': ['error', { allowEmptyCatch: true }], // the codebase's deliberate catch { /* why */ } idiom
      'no-useless-escape': 'warn',
      'no-useless-assignment': 'warn',
    },
  },
  {
    // deliberate browser+node dual-env helper — Buffer is the guarded node path
    files: ['src/lib/backend/crypto.js'],
    languageOptions: { globals: { Buffer: 'readonly' } },
  },
  {
    files: ['src/**/__tests__/**', '**/*.test.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // node CLIs (bulk import, deck rendering) — not part of `npm run lint`'s
    // src gate, but lintable on demand with the right globals
    files: ['scripts/**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
    rules: { 'no-useless-escape': 'warn' }, // same stance as the src block
  },
];

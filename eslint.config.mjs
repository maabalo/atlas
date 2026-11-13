// ESLint flat config. viewer/app.js is a classic browser script (inlined into graph.html, not a module).
import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: globals.browser,
    },
    rules: {
      eqeqeq: 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      curly: ['error', 'multi-line'],
    },
  },
  {
    // core.js also loads in Node for its tests (module.exports)
    files: ['viewer/core.js'],
    languageOptions: { globals: { ...globals.browser, module: 'readonly' } },
  },
];

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'public', '.logs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
  {
    // TypeScriptは未定義参照をtscが検出するのでno-undefは切る
    files: ['**/*.ts'],
    rules: { 'no-undef': 'off' },
  },
  {
    files: ['tools/**/*.mjs', 'tests/**/*.ts', 'tests/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly', console: 'readonly', Buffer: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly',
        clearInterval: 'readonly', URL: 'readonly', fetch: 'readonly', window: 'readonly',
      },
    },
  }
);

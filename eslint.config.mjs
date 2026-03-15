import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'out/',
      '.vite/',
      'node_modules/',
      'e2e/',
      'src/__tests__/',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
    ],
  },
  ...tseslint.configs.recommended,
  {
    plugins: {
      'import-x': importX,
      'react-hooks': reactHooks,
    },
    rules: {
      // Circular dependency detection
      'import-x/no-cycle': ['error', { maxDepth: Infinity }],

      // Useful import rules
      'import-x/no-duplicates': 'error',
      'import-x/no-self-import': 'error',

      // React hooks rules
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // Relax some typescript-eslint defaults for existing code
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
    },
    settings: {
      'import-x/resolver': {
        typescript: true,
      },
    },
  },
  prettier,
);

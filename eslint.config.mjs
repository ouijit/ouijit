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
      '.vite-e2e/',
      'node_modules/',
      'e2e/',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
    ],
  },
  ...tseslint.configs.recommended,
  importX.flatConfigs.typescript,
  {
    plugins: {
      'import-x': importX,
      'react-hooks': reactHooks,
    },
    rules: {
      // Useful import rules
      'import-x/first': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/no-self-import': 'error',

      // src/agents is kept ready to publish as its own package: it imports
      // nothing else of ours, and the app reaches it only through its index
      // and its renderer-safe model.
      'import-x/no-restricted-paths': ['error', {
        zones: [
          { target: './src/agents', from: './src', except: ['./agents'] },
          {
            target: ['./src/*.*', './src/!(agents)/**/*'],
            from: './src/agents',
            except: ['./index.ts', './model.ts'],
          },
        ],
      }],

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
  },
  prettier,
);

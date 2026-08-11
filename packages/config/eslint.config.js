// Shared ESLint flat config, applied once at the monorepo root — see
// CODESTYLE.md §4 for why formatting rules live in Biome, not here.
import boundaries from 'eslint-plugin-boundaries'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/*.gen.ts',
      '**/next-env.d.ts',
    ],
  },
  ...tseslint.configs.recommended,
  {
    plugins: { boundaries },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-floating-promises': 'off', // needs type info; Biome/tsc catch the common cases
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            { from: 'apps', allow: ['packages'] },
            { from: 'packages', allow: ['packages'] },
          ],
        },
      ],
    },
    settings: {
      'boundaries/elements': [
        { type: 'apps', pattern: 'apps/*' },
        { type: 'packages', pattern: 'packages/*' },
      ],
    },
  },
  {
    // CLI entrypoints, not services — CODESTYLE.md §8.1 scopes the
    // console.log ban to services.
    files: ['**/scripts/**/*.ts', '**/src/migrate.ts', '**/src/seed/run.ts', '**/src/server.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Declaration merging into a third-party module (Fastify decorators)
    // requires `interface` — `type` can't merge, so the repo-wide rule
    // above doesn't apply inside `declare module` blocks.
    files: ['**/src/middleware/require-auth.ts', '**/src/plugins/db.ts', '**/src/plugins/redis.ts'],
    rules: {
      '@typescript-eslint/consistent-type-definitions': 'off',
    },
  },
)

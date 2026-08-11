// Shared ESLint flat config. Consumed by every app/package in the monorepo —
// see CODESTYLE.md §4 for why formatting rules live in Biome, not here.
import boundaries from 'eslint-plugin-boundaries'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/.next/**', '**/.turbo/**', '**/coverage/**'],
  },
  ...tseslint.configs.strictTypeChecked,
  {
    plugins: { boundaries },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
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
)

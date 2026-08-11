// Resolved relative to this file rather than the caller's cwd, so both
// `pnpm db:migrate` and integration tests in other packages (apps/api) find
// the same migrations directory regardless of where they run from.
export function migrationsFolderUrl(): URL {
  return new URL('../migrations', import.meta.url)
}

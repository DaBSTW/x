import { customType } from 'drizzle-orm/pg-core'

// Postgres CITEXT: case-insensitive text, used for email so `UNIQUE` and
// lookups don't need a separate lower(email) index (SPECS.md §4.2).
export const citext = customType<{ data: string }>({
  dataType() {
    return 'citext'
  },
})

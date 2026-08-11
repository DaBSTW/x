import type { EntityKind } from '@x/utils'

// Matches packages/db's post_entities.kind SMALLINT encoding — SPECS.md §4.2.
export const ENTITY_KIND_CODES: Record<EntityKind, number> = {
  mention: 0,
  hashtag: 1,
  url: 2,
  cashtag: 3,
}

export const ENTITY_KIND_NAMES: Record<number, EntityKind> = {
  0: 'mention',
  1: 'hashtag',
  2: 'url',
  3: 'cashtag',
}

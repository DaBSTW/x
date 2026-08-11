// A dedicated entry point (see package.json's "./text" export) so
// browser-facing code (apps/web's composer) can import grapheme counting
// without pulling in password.ts (@node-rs/argon2, a native addon) or
// snowflake/id.ts (reads process.env at module load) through the main
// barrel — neither of those runs in a browser bundle.
export { parseEntities } from './entities.js'
export type { EntityKind, ParsedEntity } from './entities.js'
export { MAX_POST_GRAPHEMES, countCharacters } from './character-count.js'

import {
  bigint,
  boolean,
  index,
  pgTable,
  primaryKey,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'
import { users } from './users.js'

// ROADMAP.md 2.8 / SPECS.md §4.2's schema — a list is owned by exactly one
// user; membership is `list_members`, a separate many-to-many table below.
export const lists = pgTable(
  'lists',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey(),
    ownerId: bigint('owner_id', { mode: 'bigint' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 25 }).notNull(),
    description: varchar('description', { length: 100 }),
    isPrivate: boolean('is_private').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_lists_owner').on(table.ownerId, table.createdAt.desc())],
)
export type List = typeof lists.$inferSelect
export type NewList = typeof lists.$inferInsert

export const listMembers = pgTable(
  'list_members',
  {
    listId: bigint('list_id', { mode: 'bigint' })
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    userId: bigint('user_id', { mode: 'bigint' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.listId, table.userId] }),
    // GET /timeline/list/:id (ROADMAP.md 2.8): every member's recent posts,
    // joined post-author-id = list_members.user_id for a given listId.
    index('idx_list_members_user').on(table.userId),
  ],
)
export type ListMember = typeof listMembers.$inferSelect
export type NewListMember = typeof listMembers.$inferInsert

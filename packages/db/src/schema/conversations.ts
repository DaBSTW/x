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

// ROADMAP.md 2.5 / SPECS.md §4.2's schema.
export const conversations = pgTable('conversations', {
  id: bigint('id', { mode: 'bigint' }).primaryKey(),
  isGroup: boolean('is_group').notNull().default(false),
  name: varchar('name', { length: 50 }),
  createdBy: bigint('created_by', { mode: 'bigint' })
    .notNull()
    .references(() => users.id),
  // Denormalized onto the conversation row so GET /conversations can sort
  // "most recently active first" with one index, not a join+aggregate over
  // messages per row.
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
export type Conversation = typeof conversations.$inferSelect
export type NewConversation = typeof conversations.$inferInsert

export const conversationMembers = pgTable(
  'conversation_members',
  {
    conversationId: bigint('conversation_id', { mode: 'bigint' })
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: bigint('user_id', { mode: 'bigint' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lastReadId: bigint('last_read_id', { mode: 'bigint' }),
    muted: boolean('muted').notNull().default(false),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.userId] }),
    // GET /conversations: every conversation a given user belongs to.
    index('idx_conversation_members_user').on(table.userId),
  ],
)
export type ConversationMember = typeof conversationMembers.$inferSelect
export type NewConversationMember = typeof conversationMembers.$inferInsert

export const messages = pgTable(
  'messages',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey(),
    conversationId: bigint('conversation_id', { mode: 'bigint' })
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: bigint('sender_id', { mode: 'bigint' })
      .notNull()
      .references(() => users.id),
    text: varchar('text', { length: 10000 }),
    mediaId: bigint('media_id', { mode: 'bigint' }),
    sharedPostId: bigint('shared_post_id', { mode: 'bigint' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('idx_messages_conv').on(table.conversationId, table.id.desc())],
)
export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert

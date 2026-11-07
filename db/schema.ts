import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const userStates = sqliteTable('user_states', {
  userId: text('user_id').primaryKey(),
  payload: text('payload').notNull(),
  revision: integer('revision').notNull().default(1),
});

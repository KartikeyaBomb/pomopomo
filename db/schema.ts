import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const userStates = sqliteTable('user_states', {
  userId: text('user_id').primaryKey(),
  payload: text('payload').notNull(),
  revision: integer('revision').notNull().default(1),
});

export const activitySessions = sqliteTable('activity_sessions', {
  userId: text('user_id').notNull(),
  id: text('id').notNull(),
  mode: text('mode', { enum: ['focus', 'break'] }).notNull(),
  taskId: text('task_id'),
  taskName: text('task_name'),
  completedAt: integer('completed_at').notNull(),
  durationSeconds: integer('duration_seconds').notNull(),
}, table => [
  primaryKey({ columns: [table.userId, table.id] }),
  index('activity_user_date_idx').on(table.userId, table.completedAt),
]);

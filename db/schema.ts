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

export const devices = sqliteTable('devices', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), name: text('name').notNull(),
  tokenHash: text('token_hash').unique(), pairingHash: text('pairing_hash').unique(), pairingExpires: integer('pairing_expires').notNull(),
  createdAt: integer('created_at').notNull(), pairedAt: integer('paired_at'), revokedAt: integer('revoked_at'),
});
export const timerCommands = sqliteTable('timer_commands', {
  userId: text('user_id').notNull(), actor: text('actor').notNull(), commandId: text('command_id').notNull(), requestHash: text('request_hash').notNull(), revision: integer('revision').notNull(),
}, table => [primaryKey({ columns: [table.userId, table.actor, table.commandId] })]);

import { z } from 'zod';

export const activitySchema = z.object({
  id: z.string().min(1).max(200),
  mode: z.enum(['focus', 'break']),
  taskId: z.string().max(100).nullable(),
  taskName: z.string().max(120).nullable(),
  completedAt: z.number().int().min(0).max(8640000000000000),
  durationSeconds: z.number().int(),
}).superRefine((entry, ctx) => {
  if (entry.durationSeconds !== (entry.mode === 'focus' ? 1500 : 300)) ctx.addIssue({ code: 'custom', message: 'Invalid session duration' });
  if (entry.id !== `${entry.mode}:${entry.taskId ?? ''}:${entry.completedAt}`) ctx.addIssue({ code: 'custom', message: 'Invalid session identity' });
});
export type Activity = z.infer<typeof activitySchema>;
export const activityBatchSchema = z.object({ entries: z.array(activitySchema).min(1).max(50) });
export function mergeActivity(...groups: Activity[][]): Activity[] {
  const entries = new Map<string, Activity>();
  for (const group of groups) for (const entry of group) if (!entries.has(entry.id)) entries.set(entry.id, entry);
  return [...entries.values()].sort((a, b) => b.completedAt - a.completedAt || a.id.localeCompare(b.id));
}
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function monthRange(month: Date) {
  return { start: new Date(month.getFullYear(), month.getMonth(), 1).getTime(), end: new Date(month.getFullYear(), month.getMonth() + 1, 1).getTime() };
}
export function calendarDays(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const mondayOffset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => new Date(first.getFullYear(), first.getMonth(), 1 - mondayOffset + index, 12));
}
export function activityTotals(entries: Activity[]) {
  const unique = mergeActivity(entries);
  const focus = unique.filter(entry => entry.mode === 'focus');
  return { pomodoros: focus.length, focusMinutes: focus.reduce((sum, entry) => sum + entry.durationSeconds / 60, 0), breaks: unique.length - focus.length, activeDays: new Set(focus.map(entry => dateKey(new Date(entry.completedAt)))).size };
}

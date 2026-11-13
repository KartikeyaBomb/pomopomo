import { z } from 'zod';

export const segmentSchema = z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).refine(span => span.end > span.start);
export type FocusSegment = z.infer<typeof segmentSchema>;

export const activitySchema = z.object({
  id: z.string().min(1).max(200),
  mode: z.enum(['focus', 'break']),
  taskId: z.string().max(100).nullable(),
  taskName: z.string().max(120).nullable(),
  completedAt: z.number().int().min(0).max(8640000000000000),
  durationSeconds: z.number().int(),
  segments: z.array(segmentSchema).max(200).optional(),
}).superRefine((entry, ctx) => {
  if (entry.segments?.some((span, index, spans) => span.end > entry.completedAt || (index > 0 && span.start < spans[index - 1].end))) ctx.addIssue({ code: 'custom', message: 'Invalid session timing' });
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

// Local calendar arithmetic preserves the 8 AM boundary across DST changes.
export function activityDate(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (now.getHours() < 8 ? 1 : 0), 12);
}
export function activityDayRange(date: Date) {
  return { start: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 8).getTime(), end: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 8).getTime() };
}
export function sessionSegments(entry: Activity): FocusSegment[] {
  return entry.segments ?? [{ start: entry.completedAt - entry.durationSeconds * 1000, end: entry.completedAt }];
}
export function activityIntersects(entry: Activity, start: number, end: number) {
  return sessionSegments(entry).some(span => span.start < end && span.end > start);
}
export type DayLogLine = FocusSegment & { taskId: string | null; name: string; estimated: boolean };
export function dayLogLines(entries: Activity[], date: Date): DayLogLine[] {
  const { start, end } = activityDayRange(date);
  const spans = mergeActivity(entries).filter(entry => entry.mode === 'focus').flatMap(entry => sessionSegments(entry).map(span => ({ start: Math.max(start, span.start), end: Math.min(end, span.end), taskId: entry.taskId, name: (entry.taskName ?? 'Focus session').replace(/\s+/g, ' ').trim(), estimated: entry.segments === undefined }))).filter(span => span.end > span.start).sort((a,b) => a.start-b.start || a.end-b.end || a.name.localeCompare(b.name));
  const lines: DayLogLine[] = [];
  for (const span of spans) {
    const previous = lines.at(-1);
    // Adjacent sessions of the same task read as one continuous work block.
    if (previous && previous.taskId === span.taskId && previous.name === span.name && span.start >= previous.end && span.start - previous.end < 60000) { previous.end = span.end; previous.estimated ||= span.estimated; }
    else lines.push({ ...span });
  }
  return lines;
}
export function logTime(timestamp: number): string {
  const date = new Date(timestamp), hour = date.getHours() % 12 || 12;
  return date.getMinutes() ? `${hour}:${String(date.getMinutes()).padStart(2, '0')}` : String(hour);
}
export function formatDayLog(lines: DayLogLine[]): string {
  return lines.map((line, index) => `${index && line.start - lines[index - 1].end >= 60000 ? '\n' : ''}${logTime(line.start)} - ${logTime(line.end)} ${line.name}`).join('\n');
}

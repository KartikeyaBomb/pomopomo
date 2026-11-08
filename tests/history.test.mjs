import test from 'node:test';
import assert from 'node:assert/strict';
import { activityFor, settleTimer } from '../lib/pomodoro.ts';
import { activitySchema, activityTotals, calendarDays, dateKey, mergeActivity, monthRange } from '../lib/activity.ts';
process.env.TZ = 'America/Chicago';
const task = { id: 'a', name: 'Original task', estimate: 5, done: 0, color: '#e99573' };
const deadline = Date.parse('2026-11-09T05:30:00Z');
const timer = { taskId: 'a', mode: 'focus', remaining: 1500, deadline };
const entry = activityFor([task], timer, deadline);
test('history uses the actual deadline when a sleeping app resumes later', () => {
  const delayed = activityFor([task], timer, deadline + 12 * 3600000);
  assert.equal(delayed.completedAt, deadline);
  assert.equal(delayed.durationSeconds, 1500);
  assert.equal(dateKey(new Date(delayed.completedAt)), '2026-11-08');
  const settled = settleTimer([task], timer, deadline);
  assert.equal(activityFor(settled.tasks, settled.timer, deadline + 1), null);
  assert.equal(activityFor([task], { ...timer, deadline: null, remaining: 750 }, deadline), null);
});
test('history snapshots retain task names after a rename or deletion', () => {
  const changedTask = { ...task, name: 'New task name' };
  assert.equal(entry.taskName, 'Original task');
  assert.notEqual(entry.taskName, changedTask.name);
  assert.equal(mergeActivity([entry], [entry]).length, 1);
  assert.equal(mergeActivity([entry], [{ ...entry, taskName: 'Other device rename' }])[0].taskName, 'Original task');
});
test('monthly totals count completed focus time separately from breaks', () => {
  const rest = activityFor([task], { ...timer, mode: 'break', remaining: 300, deadline: deadline + 300000 }, deadline + 300000);
  assert.deepEqual(activityTotals([entry, entry, rest]), { pomodoros: 1, focusMinutes: 25, breaks: 1, activeDays: 1 });
});
test('calendar handles local midnight, DST and leap years', () => {
  const range = monthRange(new Date(2026, 10, 15));
  assert.equal(new Date(range.start).getDate(), 1);
  assert.equal(new Date(range.end).getMonth(), 11);
  assert.equal((range.end - range.start) / 3600000, 721);
  const days = calendarDays(new Date(2028, 1, 1));
  assert.equal(days.length, 42);
  assert.equal(days[0].getDay(), 1);
  assert.equal(days.filter(day => day.getMonth() === 1).length, 29);
  assert.equal(new Set(days.map(dateKey)).size, 42);
});
test('history schema rejects mismatched IDs and invalid durations', () => {
  assert.equal(activitySchema.safeParse(entry).success, true);
  assert.equal(activitySchema.safeParse({ ...entry, id: 'invented' }).success, false);
  assert.equal(activitySchema.safeParse({ ...entry, durationSeconds: 999 }).success, false);
  assert.equal(activitySchema.safeParse({ ...entry, completedAt: -1 }).success, false);
});

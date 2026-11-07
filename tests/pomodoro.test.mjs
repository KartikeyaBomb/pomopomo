import test from 'node:test';
import assert from 'node:assert/strict';
import { pickTask, settleTimer, FOCUS_SECONDS, BREAK_SECONDS } from '../lib/pomodoro.ts';
const tasks = [{ id: 'a', name: 'Task A', estimate: 5, done: 0, color: '#e99573' }, { id: 'b', name: 'Task B', estimate: 15, done: 0, color: '#e4be66' }];
test('5 versus 15 allocates exactly one quarter of the random interval to A', () => {
  let a = 0;
  for (let i = 0; i < 10000; i++) if (pickTask(tasks, i / 10000).id === 'a') a++;
  assert.equal(a, 2500);
  assert.equal(pickTask(tasks, 0.249999).id, 'a');
  assert.equal(pickTask(tasks, 0.25).id, 'b');
});
test('completed sessions change weights and completed tasks are excluded', () => {
  const progressed = [{ ...tasks[0], done: 5 }, tasks[1]];
  assert.equal(pickTask(progressed, 0).id, 'b');
  assert.equal(pickTask([], 0.5), null);
  assert.equal(pickTask(tasks.map(t => ({ ...t, done: t.estimate })), 0.5), null);
});
test('expired focus sessions credit the selected task exactly once', () => {
  const timer = { taskId: 'a', mode: 'focus', remaining: FOCUS_SECONDS, deadline: 1000 };
  assert.equal(settleTimer(tasks, timer, 999).finished, false);
  const result = settleTimer(tasks, timer, 1000);
  assert.equal(result.tasks[0].done, 1);
  assert.equal(result.tasks[1].done, 0);
  assert.equal(result.timer.deadline, null);
  assert.equal(settleTimer(result.tasks, result.timer, 100000).tasks[0].done, 1);
});
test('break completion and paused sessions never credit a task', () => {
  const result = settleTimer(tasks, { taskId: 'a', mode: 'break', remaining: BREAK_SECONDS, deadline: 1000 }, 10000);
  assert.equal(result.tasks[0].done, 0);
  assert.equal(result.timer.remaining, BREAK_SECONDS);
  assert.equal(settleTimer(tasks, { taskId: 'a', mode: 'focus', remaining: 900, deadline: null }, 10000).finished, false);
});

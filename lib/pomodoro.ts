export type Task = { id: string; name: string; description?: string; estimate: number; done: number; color: string };
export type Timer = { taskId: string | null; mode: 'focus' | 'break'; remaining: number; deadline: number | null };
export const FOCUS_SECONDS = 25 * 60;
export const BREAK_SECONDS = 5 * 60;
export const colors = ['#e99573', '#e4be66', '#94aca0', '#a6a2c8', '#8eafbe', '#ce96a4'];
export const remaining = (task: Task) => Math.max(0, task.estimate - task.done);
export function pickTask(tasks: Task[], random: number) {
  const total = tasks.reduce((sum, task) => sum + remaining(task), 0);
  if (total === 0) return null;
  let boundary = 0;
  for (const task of tasks) {
    boundary += remaining(task);
    if (random * total < boundary) return task;
  }
  return tasks.filter(task => remaining(task) > 0).at(-1) ?? null;
}
export function settleTimer(tasks: Task[], timer: Timer, now: number) {
  if (timer.deadline === null || timer.deadline > now) return { tasks, timer, finished: false };
  return {
    tasks: timer.mode === 'focus' ? tasks.map(task => task.id === timer.taskId ? { ...task, done: Math.min(task.estimate, task.done + 1) } : task) : tasks,
    timer: { ...timer, deadline: null, remaining: timer.mode === 'focus' ? FOCUS_SECONDS : BREAK_SECONDS },
    finished: true,
  };
}

export type TaskChanges = { name: string; description: string; estimate: number };
export function editTask(task: Task, changes: TaskChanges, timer: Timer): Task {
  const name = changes.name.trim();
  const description = changes.description.trim();
  if (!name || name.length > 120) throw new Error('Enter a task name (up to 120 characters).');
  if (description.length > 5000) throw new Error('Description must be 5,000 characters or fewer.');
  const inSession = timer.mode === 'focus' && timer.taskId === task.id && (timer.deadline !== null || timer.remaining < FOCUS_SECONDS);
  const minimum = Math.max(1, task.done + (inSession ? 1 : 0));
  if (!Number.isInteger(changes.estimate) || changes.estimate < minimum || changes.estimate > 999) {
    throw new Error(`Enter ${minimum}–999 total pomodoros.${inSession ? ' Includes the current session.' : task.done ? ' Completed pomodoros are preserved.' : ''}`);
  }
  return { ...task, name, description, estimate: changes.estimate };
}
export function sessionProgress(timer: Timer, now: number): number {
  const duration = timer.mode === 'focus' ? FOCUS_SECONDS : BREAK_SECONDS;
  const seconds = timer.deadline === null ? timer.remaining : (timer.deadline - now) / 1000;
  return Math.max(0, Math.min(1, 1 - seconds / duration));
}

import { z } from 'zod';
import { FOCUS_SECONDS, BREAK_SECONDS, remaining } from './pomodoro';
import type { AppState } from './state-schema';
export const timerActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('select'), taskId: z.string().min(1).max(100) }),
  z.object({ type: z.literal('start') }), z.object({ type: z.literal('pause') }),
  z.object({ type: z.literal('resume') }), z.object({ type: z.literal('reset') }),
  z.object({ type: z.literal('settle') }),
  z.object({ type: z.literal('mode'), mode: z.enum(['focus', 'break']) }),
  z.object({ type: z.literal('break') }),
]);
export type TimerAction = z.infer<typeof timerActionSchema>;
export const commandSchema = z.object({ commandId: z.string().uuid(), revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 2), action: timerActionSchema });
export function applyTimerAction(state: AppState, action: TimerAction, now: number): AppState {
  const timer = { ...state.timer };
  const duration = timer.mode === 'focus' ? FOCUS_SECONDS : BREAK_SECONDS;
  const busy = timer.deadline !== null || timer.remaining < duration;
  if (action.type === 'settle') return state;
  if (action.type === 'select') {
    if (busy) throw new Error('Finish or reset the current session first.');
    if (!state.tasks.some(t => t.id === action.taskId && remaining(t) > 0)) throw new Error('Task is unavailable.');
    return { ...state, timer: { taskId: action.taskId, mode: 'focus', remaining: FOCUS_SECONDS, deadline: null } };
  }
  if (action.type === 'mode' || action.type === 'break') {
    if (busy) throw new Error('Finish or reset the current session first.');
    delete timer.segments; delete timer.runStartedAt;
    timer.mode = action.type === 'break' ? 'break' : action.mode;
    timer.remaining = timer.mode === 'focus' ? FOCUS_SECONDS : BREAK_SECONDS;
    timer.deadline = action.type === 'break' ? now + BREAK_SECONDS * 1000 : null;
    if (action.type === 'break') { timer.segments = []; timer.runStartedAt = now; }
  } else if (action.type === 'reset') { timer.deadline = null; timer.remaining = duration; delete timer.segments; delete timer.runStartedAt; }
  else if (action.type === 'pause') {
    if (timer.deadline !== null) {
      if (timer.segments && timer.runStartedAt !== undefined && now > timer.runStartedAt) {
        if (timer.segments.length >= 199) throw new Error('Too many pauses in this session.');
        timer.segments = [...timer.segments, { start: timer.runStartedAt, end: now }];
      }
      delete timer.runStartedAt;
      timer.remaining = Math.max(0, Math.ceil((timer.deadline - now) / 1000)); timer.deadline = null; }
  } else {
    if (timer.deadline !== null) return state;
    if (timer.mode === 'focus' && !state.tasks.some(t => t.id === timer.taskId && remaining(t) > 0)) throw new Error('Select an unfinished task.');
    if (timer.remaining === duration && timer.segments === undefined) timer.segments = [];
    if (timer.segments !== undefined) timer.runStartedAt = now;
    timer.deadline = now + timer.remaining * 1000;
  }
  return { ...state, timer };
}

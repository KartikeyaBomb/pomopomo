import { z } from 'zod';
import { segmentSchema } from './activity';
import { colors, FOCUS_SECONDS, BREAK_SECONDS } from './pomodoro';
const taskSchema = z.object({
  id: z.string().min(1).max(100), name: z.string().trim().min(1).max(120),
  description: z.string().max(5000).optional(),
  estimate: z.number().int().min(1).max(999), done: z.number().int().min(0).max(999),
  color: z.string().refine(value => colors.includes(value)),
}).refine(task => task.done <= task.estimate);
export const stateSchema = z.object({
  tasks: z.array(taskSchema).max(1000),
  timer: z.object({
    taskId: z.string().max(100).nullable(), mode: z.enum(['focus', 'break']),
    remaining: z.number().finite().int().min(0).max(FOCUS_SECONDS),
    deadline: z.number().finite().nonnegative().nullable(),
    segments: z.array(segmentSchema).max(199).optional(),
    runStartedAt: z.number().int().nonnegative().optional(),
  }),
}).superRefine((state, ctx) => {
  if (new Set(state.tasks.map(task => task.id)).size !== state.tasks.length) ctx.addIssue({ code: 'custom', message: 'Task IDs must be unique' });
  if (state.timer.taskId !== null && !state.tasks.some(task => task.id === state.timer.taskId)) ctx.addIssue({ code: 'custom', message: 'Timer task must exist' });
  if (state.timer.mode === 'focus' && state.timer.deadline !== null && state.timer.taskId === null) ctx.addIssue({ code: 'custom', message: 'Focus requires a task' });
  if (state.timer.mode === 'break' && state.timer.remaining > BREAK_SECONDS) ctx.addIssue({ code: 'custom', message: 'Break cannot exceed five minutes' });
});
export type AppState = z.infer<typeof stateSchema>;
export const updateSchema = z.object({ state: stateSchema, revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1) });

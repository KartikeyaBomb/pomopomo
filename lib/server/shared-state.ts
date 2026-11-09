import { activityFor, settleTimer, FOCUS_SECONDS } from '../pomodoro';
import { applyTimerAction, type TimerAction } from '../timer-actions';
import { stateSchema, type AppState } from '../state-schema';
export const initialState: AppState = { tasks: [], timer: { taskId: null, mode: 'focus', remaining: FOCUS_SECONDS, deadline: null } };
export const digest = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('');
export class SharedState {
  constructor(private db: D1Database) {}
  async read(userId: string) {
    const row = await this.db.prepare('SELECT payload, revision FROM user_states WHERE user_id=?').bind(userId).first<{ payload: string; revision: number }>();
    return { state: row ? stateSchema.parse(JSON.parse(row.payload)) : initialState, revision: row?.revision ?? 0 };
  }
  async ensure(userId: string) {
    await this.db.prepare('INSERT OR IGNORE INTO user_states(user_id,payload,revision) VALUES(?,?,0)').bind(userId, JSON.stringify(initialState)).run();
  }
  // All conditional statements see the same revision inside one D1 transaction.
  async commit(userId: string, revision: number, state: AppState, entry: ReturnType<typeof activityFor> = null, receipt?: { id: string; hash: string; actor: string }) {
    const statements: D1PreparedStatement[] = [];
    if (entry) statements.push(this.db.prepare(`INSERT OR IGNORE INTO activity_sessions(user_id,id,mode,task_id,task_name,completed_at,duration_seconds) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM user_states WHERE user_id=? AND revision=?)`).bind(userId, entry.id, entry.mode, entry.taskId, entry.taskName, entry.completedAt, entry.durationSeconds, userId, revision));
    if (receipt) statements.push(this.db.prepare(`INSERT INTO timer_commands(user_id,actor,command_id,request_hash,revision) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM user_states WHERE user_id=? AND revision=?)`).bind(userId, receipt.actor, receipt.id, receipt.hash, revision + 1, userId, revision));
    statements.push(this.db.prepare('UPDATE user_states SET payload=?,revision=revision+1 WHERE user_id=? AND revision=?').bind(JSON.stringify(state), userId, revision));
    const results = await this.db.batch(statements);
    return results.at(-1)!.meta.changes === 1;
  }
  async settled(userId: string, now = Date.now()) {
    await this.ensure(userId);
    for (let attempt = 0; attempt < 6; attempt++) {
      const current = await this.read(userId);
      const result = settleTimer(current.state.tasks, current.state.timer, now);
      if (!result.finished) return current;
      if (await this.commit(userId, current.revision, { tasks: result.tasks, timer: result.timer }, activityFor(current.state.tasks, current.state.timer, now))) return { state: { tasks: result.tasks, timer: result.timer }, revision: current.revision + 1 };
    }
    throw new Error('State is busy; retry.');
  }
  async command(userId: string, actor: string, input: { commandId: string; revision: number; action: TimerAction }, now = Date.now()) {
    const hash = await digest(JSON.stringify(input));
    const receipt = () => this.db.prepare('SELECT request_hash FROM timer_commands WHERE user_id=? AND actor=? AND command_id=?').bind(userId, actor, input.commandId).first<{ request_hash: string }>();
    const previous = await receipt();
    if (previous) return { status: previous.request_hash === hash ? 200 : 409, body: { ...await this.settled(userId, now), replayed: true, ...(previous.request_hash !== hash ? { error: 'Command ID reused with different data.' } : {}) } };
    const current = await this.settled(userId, now);
    if (current.revision !== input.revision) return { status: 409, body: { ...current, error: 'State changed. Review it before retrying.' } };
    let next: AppState;
    try { next = applyTimerAction(current.state, input.action, now); } catch (error) { return { status: 422, body: { ...current, error: (error as Error).message } }; }
    let committed = false;
    try { committed = await this.commit(userId, current.revision, next, null, { id: input.commandId, hash, actor }); }
    catch (error) { if (!await receipt()) throw error; }
    if (committed) return { status: 200, body: { state: next, revision: current.revision + 1 } };
    const concurrent = await receipt();
    return { status: concurrent?.request_hash === hash ? 200 : 409, body: { ...await this.settled(userId, now), replayed: concurrent?.request_hash === hash } };
  }
  async saveTasks(userId: string, revision: number, candidate: AppState) {
    const current = await this.settled(userId);
    if (current.revision !== revision) return { status: 409, body: current };
    // Timer and progress are server-owned. Older clients must refresh before writing them.
    const removedIdleTask = current.state.timer.taskId && !candidate.tasks.some(t => t.id === current.state.timer.taskId) && current.state.timer.deadline === null && current.state.timer.remaining === (current.state.timer.mode === 'focus' ? FOCUS_SECONDS : 300) && candidate.timer.taskId === null && candidate.timer.deadline === null;
    if (!removedIdleTask && JSON.stringify(candidate.timer) !== JSON.stringify(current.state.timer)) return { status: 409, body: { ...current, error: 'Timer changed. Refresh the app.' } };
    const old = new Map(current.state.tasks.map(t => [t.id, t]));
    const tasks = candidate.tasks.map(t => ({ ...t, done: old.get(t.id)?.done ?? 0, description: t.description ?? old.get(t.id)?.description }));
    const timer = current.state.timer;
    const task = tasks.find(t => t.id === timer.taskId);
    const busy = timer.deadline !== null || timer.remaining < (timer.mode === 'focus' ? FOCUS_SECONDS : 300);
    if (timer.taskId && !task && busy) return { status: 422, body: { error: 'Reset the timer before deleting its task.' } };
    if (tasks.some(t => t.estimate < t.done + (busy && timer.mode === 'focus' && t.id === timer.taskId ? 1 : 0))) return { status: 422, body: { error: 'Estimate cannot remove completed or active sessions.' } };
    const next = { tasks, timer: task || !timer.taskId ? timer : { ...timer, taskId: null } };
    return await this.commit(userId, revision, next) ? { status: 200, body: { state: next, revision: revision + 1 } } : { status: 409, body: await this.settled(userId) };
  }
}

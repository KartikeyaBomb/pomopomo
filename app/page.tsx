'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Bell, Check, CircleHelp, Coffee, Plus, RotateCcw, Shuffle, Trash2, Play, Pause, Timer as TimerIcon } from 'lucide-react';
import { useSyncedState } from '../hooks/use-synced-state';
import { useCompletionAlerts } from '../hooks/use-completion-alerts';
import { CompletionPopup } from '../components/completion-popup';
import { TaskDetails } from '../components/task-details';
import { InstallApp } from '../components/install-app';
import { BREAK_SECONDS, FOCUS_SECONDS, colors, completedAfterSync, completedSession, editTask, pickTask, remaining, sessionProgress, settleTimer, taskColor, type Task, type TaskChanges, type Timer, type Completion } from '../lib/pomodoro';

const freshTimer: Timer = { taskId: null, mode: 'focus', remaining: FOCUS_SECONDS, deadline: null };
const point = (angle: number, radius: number) => [180 + radius * Math.sin(angle * Math.PI / 180), 180 - radius * Math.cos(angle * Math.PI / 180)];

export default function Home() {
  const { state, setState, ready, storageError, status, conflict, resolveConflict } = useSyncedState();
  const alerts = useCompletionAlerts();
  const { announce } = alerts;
  const [now, setNow] = useState(0);
  const [name, setName] = useState('');
  const [estimate, setEstimate] = useState('1');
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const spinTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const { tasks, timer } = state;
  const lastObservedState = useRef(state);
  const active = tasks.filter(task => remaining(task) > 0);
  const total = active.reduce((sum, task) => sum + remaining(task), 0);
  const completed = tasks.reduce((sum, task) => sum + task.done, 0);
  const openTask = tasks.find(task => task.id === openTaskId);
  const selected = tasks.find(task => task.id === timer.taskId);
  const running = timer.deadline !== null;
  const busy = spinning || running || timer.remaining < (timer.mode === 'focus' ? FOCUS_SECONDS : BREAK_SECONDS);
  const seconds = running ? Math.max(0, Math.ceil((timer.deadline! - now) / 1000)) : timer.remaining;
  const progress = sessionProgress(timer, now);
  const taskProgress = (task: Task) => Math.min(1, (task.done + (timer.taskId === task.id && timer.mode === 'focus' ? progress : 0)) / task.estimate);
  const time = `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;

  useEffect(() => {
    setNow(Date.now());
    return () => { if (spinTimeout.current) clearTimeout(spinTimeout.current); };
  }, []);

  useEffect(() => {
    if (!running) return;
    const tick = () => {
      const current = Date.now(); setNow(current);
      if (timer.deadline! <= current) {
        let completion: Completion | null = null;
        setState(previous => {
          completion = completedSession(previous.tasks, previous.timer, current);
          const result = settleTimer(previous.tasks, previous.timer, current);
          return { tasks: result.tasks, timer: result.timer };
        });
        if (completion) announce(completion);
        setNotice(timer.mode === 'focus' ? 'Pomodoro complete.' : 'Break complete.');
      }
    };
    tick();
    const interval = setInterval(tick, 250);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', tick); };
  }, [running, timer.deadline, timer.mode, setState, announce]);

  useEffect(() => {
    const completion = completedAfterSync(lastObservedState.current, state, Date.now());
    lastObservedState.current = state;
    if (completion) announce(completion);
  }, [state, announce]);

  useEffect(() => {
    if (spinTimeout.current) { clearTimeout(spinTimeout.current); spinTimeout.current = null; setSpinning(false); }
  }, [tasks, timer.deadline]);

  useEffect(() => { document.title = running ? `${time} · Pomopomo` : 'Pomopomo'; }, [running, time]);

  function select(task: Task) {
    if (busy) return;
    setState(previous => ({ ...previous, timer: { ...freshTimer, taskId: task.id } }));
    setNotice(`Selected: ${task.name}`);
  }
  function spin() {
    if (busy || total === 0) return;
    const values = new Uint32Array(1); crypto.getRandomValues(values);
    const random = values[0] / 4294967296;
    const winner = pickTask(tasks, random)!;
    const next = rotation + 360 * 5 + ((360 - random * 360 - rotation % 360) % 360 + 360) % 360;
    setSpinning(true); setNotice(''); setRotation(next);
    const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 50 : 4200;
    spinTimeout.current = setTimeout(() => {
      setState(previous => ({ ...previous, timer: { ...freshTimer, taskId: winner.id } }));
      setNotice(`Selected: ${winner.name}`); setSpinning(false);
    }, delay);
  }
  function toggleTimer() {
    if (spinning || (timer.mode === 'focus' && (!selected || !remaining(selected)))) return;
    const current = Date.now(); setNow(current); setNotice('');
    if (!running) alerts.prepareSound();
    let completion: Completion | null = null;
    setState(previous => {
      const settled = settleTimer(previous.tasks, previous.timer, current);
      if (settled.finished) { completion = completedSession(previous.tasks, previous.timer, current); setNotice('Session complete.'); return { tasks: settled.tasks, timer: settled.timer }; }
      return { ...previous, timer: { ...previous.timer, deadline: running ? null : current + previous.timer.remaining * 1000, remaining: running ? Math.max(0, Math.ceil((previous.timer.deadline! - current) / 1000)) : previous.timer.remaining } };
    });
    if (completion) announce(completion);
  }
  function resetTimer() { setState(previous => ({ ...previous, timer: { ...previous.timer, deadline: null, remaining: previous.timer.mode === 'focus' ? FOCUS_SECONDS : BREAK_SECONDS } })); }
  function startBreak() {
    if (busy) return;
    alerts.prepareSound(); const current = Date.now(); setNow(current);
    setState(previous => ({ ...previous, timer: { ...previous.timer, mode: 'break', remaining: BREAK_SECONDS, deadline: current + BREAK_SECONDS * 1000 } }));
  }
  function changeMode(mode: 'focus' | 'break') { if (!busy) setState(previous => ({ ...previous, timer: { ...previous.timer, mode, remaining: mode === 'focus' ? FOCUS_SECONDS : BREAK_SECONDS } })); }
  function addTask(event: React.FormEvent) {
    event.preventDefault(); const count = Number(estimate);
    if (!name.trim() || !Number.isInteger(count) || count < 1 || count > 999 || spinning) return;
    setState(previous => ({ ...previous, tasks: [...previous.tasks, { id: crypto.randomUUID(), name: name.trim(), description: '', estimate: count, done: 0, color: colors[previous.tasks.length % colors.length] }] }));
    setName(''); setEstimate('1'); nameInput.current?.focus();
  }
  function removeTask(id: string) { setState(previous => ({ tasks: previous.tasks.filter(task => task.id !== id), timer: previous.timer.taskId === id ? freshTimer : previous.timer })); }
  function saveTask(changes: TaskChanges): string | null {
    if (!openTask) return 'Task no longer exists.';
    try {
      const updated = editTask(openTask, changes, timer);
      setState(previous => ({ ...previous, tasks: previous.tasks.map(task => task.id === updated.id ? updated : task) }));
      setNotice('');
      return null;
    } catch (error) { return error instanceof Error ? error.message : 'Unable to save task.'; }
  }
  let cursor = 0;

  return <div className="app-shell">
    <header className="topbar"><a href="/" className="brand" aria-label="Pomopomo home"><span className="brand-icon"><TimerIcon size={21} strokeWidth={1.8} /></span>pomo<span className="brand-light">pomo</span><span className="brand-dot">.</span></a><InstallApp /><button className="help-button" onClick={() => setShowHelp(!showHelp)} aria-expanded={showHelp}><CircleHelp size={17} /> How it works</button></header>
    <main>
      {showHelp && <aside className="help-panel">Add your tasks and estimate how many 25-minute sessions each needs. Spin the wheel or select a task, then start the timer. Each completed session reduces its remaining count. Bigger remaining tasks get bigger slices: 5 out of 20 pomodoros = a 25% chance. Finished tasks leave the wheel. You can take a 5-minute break between sessions.</aside>}
      {conflict && <aside className="sync-conflict" role="alert"><div><strong>Your other device has changes, too.</strong><p>Choose which version to keep. This device has {tasks.length} tasks; the cloud has {conflict.state?.tasks.length ?? 0}. The replaced copy is backed up on this device.</p></div><button onClick={() => resolveConflict(false)}>Use cloud version</button><button onClick={() => resolveConflict(true)}>Use this device</button></aside>}
      {status === 'signin' && <p className="notice">Sign in to sync your tasks across devices. <a href="/signin-with-chatgpt?return_to=%2F" target="_top">Sign in</a></p>}
      {storageError && <p role="alert" className="notice">Browser storage is unavailable. Keep this tab open to retain your progress.</p>}
      <div className="workspace">
        <section className="left-column">
          <section className="timer-card" aria-labelledby="timer-heading">
            <div className="card-top"><h2 id="timer-heading"><TimerIcon size={17} /> Timer</h2><details className="alert-settings"><summary><Bell size={15} /> Alerts</summary><div className="alert-options"><label><input type="checkbox" checked={alerts.sound} onChange={alerts.toggleSound} /> Completion sound</label><button type="button" onClick={alerts.toggleNotifications}>{alerts.notifications ? 'Turn notifications off' : 'Enable notifications'}</button><p>{alerts.message || (alerts.permission === 'unsupported' ? 'Browser notifications unavailable. Popups still work.' : 'Keep the app open. Locked phones may delay alerts.')}</p></div></details></div>
            <div className="mode-switch"><button className={timer.mode === 'focus' ? 'active' : ''} disabled={busy} onClick={() => changeMode('focus')}>Pomodoro</button><button className={timer.mode === 'break' ? 'active' : ''} disabled={busy} onClick={() => changeMode('break')}><Coffee size={14} /> Short break</button></div>
            <div className="time" role="timer" aria-label={`${Math.floor(seconds / 60)} minutes ${seconds % 60} seconds remaining`}>{time}</div>
            <div className="session-progress"><progress value={progress} max={1} aria-label="Current session progress" /><span>{Math.floor(progress * 100)}%</span></div>
            <p className="focus-label">{timer.mode === 'break' ? '5-minute break' : selected && remaining(selected) ? <><span className="task-dot" style={{ background: taskColor(selected.color) }} />{selected.name}</> : 'Select a task to start.'}</p>
            <div className="timer-actions"><button className="primary start-button" disabled={!ready || spinning || (timer.mode === 'focus' && (!selected || !remaining(selected)))} onClick={toggleTimer}>{running ? <Pause size={17} fill="currentColor" /> : <Play size={16} fill="currentColor" />}{running ? 'Pause session' : timer.remaining < (timer.mode === 'focus' ? FOCUS_SECONDS : BREAK_SECONDS) ? 'Resume session' : timer.mode === 'break' ? 'Start break' : 'Start focusing'}</button><button className="reset-button" onClick={resetTimer} disabled={spinning} aria-label="Reset current timer" title="Reset current timer"><RotateCcw size={18} /></button></div>
            <p className="timer-footnote">{busy && !spinning ? 'Finish or reset to switch tasks.' : ''}</p>
          </section>
          <section className="tasks-card" aria-labelledby="tasks-heading"><div className="tasks-title"><h2 id="tasks-heading">Tasks <span>{active.length}</span></h2><span>{total} pomos left</span></div>
            <form className="add-form" onSubmit={addTask}><div className="task-field"><label htmlFor="task-name">Task</label><input id="task-name" ref={nameInput} value={name} onChange={e => setName(e.target.value)} placeholder="Task name" maxLength={120} required disabled={!ready || spinning} /></div><div className="estimate-field"><label htmlFor="task-estimate">Pomos</label><input id="task-estimate" type="number" min="1" max="999" step="1" value={estimate} onChange={e => setEstimate(e.target.value)} required disabled={!ready || spinning} /></div><button className="add-button" disabled={!ready || spinning} aria-label="Add task" type="submit"><Plus size={21} /></button></form>
            <div className="task-list">{tasks.length === 0 ? <div className="empty-tasks">No tasks yet.</div> : tasks.map(task => <div className={`task-row ${task.id === timer.taskId ? 'selected' : ''} ${remaining(task) === 0 ? 'complete' : ''}`} key={task.id}>
              <button className="task-select" onClick={() => setOpenTaskId(task.id)} aria-label={`Open ${task.name}`} aria-haspopup="dialog"><span className="task-marker" style={{ background: remaining(task) ? taskColor(task.color) : '#e8edf8' }}>{remaining(task) === 0 && <Check size={13} />}</span><span className="task-copy"><strong>{task.name}</strong>{task.description && <span className="task-description">{task.description}</span>}<small>{task.done} of {task.estimate} pomos done{task.id === timer.taskId && remaining(task) > 0 && <span className="selected-label"> · Selected</span>}</small><progress className="task-progress" value={taskProgress(task)} max={1} aria-label={`${task.name} completion`} /></span></button>
              <span className="task-odds">{remaining(task) === 0 ? 'Done' : `${Number((remaining(task) / total * 100).toFixed(1))}%`}</span>
              <button className="task-focus-button" disabled={busy || remaining(task) === 0} onClick={() => select(task)} aria-label={`Focus on ${task.name}`} title="Focus on task"><Play size={15} /></button>
              <button className="delete-button" disabled={spinning || (task.id === timer.taskId && busy)} onClick={() => removeTask(task.id)} aria-label={`Delete ${task.name}`}><Trash2 size={15} /></button>
            </div>)}</div>
            <div className="list-footer"><TimerIcon size={13} /> 1 pomo = 25 min · {completed} completed<span className={`sync-status status-${status}`} role="status">{status === 'synced' ? 'Synced across devices' : status === 'offline' ? 'Offline · saved on this device' : status === 'conflict' ? 'Choose a version above' : status === 'signin' ? 'Sign in to sync' : 'Syncing…'}</span></div>
          </section>
        </section>
        <section className="wheel-card" aria-labelledby="wheel-heading"><div className="wheel-heading"><h2 id="wheel-heading">Task wheel</h2></div>
          <div className="wheel-wrap"><span className="wheel-pointer" /><div className="wheel-shadow"><svg className="wheel" viewBox="0 0 360 360" role="img" aria-label={total ? `Task wheel, ${active.map(t => `${t.name}: ${Number((remaining(t) / total * 100).toFixed(1))}% chance`).join(', ')}` : 'Add tasks to fill your wheel'} style={{ transform: `rotate(${rotation}deg)` }}>{total === 0 ? <><circle cx="180" cy="180" r="175" fill="#e1e6f6" /><path d="M180 5V355M5 180H355" stroke="#f9fbff" strokeWidth="3" /><path d="M56 56L304 304M56 304L304 56" stroke="#f9fbff" strokeWidth="3" /></> : active.map((task) => {
            const start = cursor; const angle = remaining(task) / total * 360; cursor += angle;
            const a = point(start, 175), b = point(cursor, 175), middle = start + angle / 2, label = point(middle, 112);
            return <g key={task.id}>{angle === 360 ? <circle cx="180" cy="180" r="175" fill={taskColor(task.color)} /> : <path d={`M180 180 L${a[0]} ${a[1]} A175 175 0 ${angle > 180 ? 1 : 0} 1 ${b[0]} ${b[1]} Z`} fill={taskColor(task.color)} stroke="#f9fbff" strokeWidth="2" />}{angle > 20 && <text x={label[0]} y={label[1]} transform={`rotate(${middle}, ${label[0]}, ${label[1]})`} textAnchor="middle" dominantBaseline="middle" fill="#35456b" fontSize="13" fontWeight="600">{task.name.length > 14 ? task.name.slice(0, 12) + '…' : task.name}</text>}</g>;
          })}</svg><div className="wheel-hub"><Shuffle size={24} strokeWidth={1.6} /></div></div></div>
          <button className="spin-button" disabled={!ready || total === 0 || busy} onClick={spin}><Shuffle size={18} />{spinning ? 'Spinning…' : 'Spin'}<ArrowRight size={17} /></button>
          <div className="wheel-result" aria-live="polite">{notice || (total === 0 ? tasks.length ? 'All tasks complete.' : 'Add a task to spin.' : '')}</div>
        </section>
      </div>
    </main>
    {openTask && <TaskDetails key={openTask.id} task={openTask} timer={timer} progress={taskProgress(openTask)} busy={busy} spinning={spinning} onSave={saveTask} onFocus={() => select(openTask)} onClose={() => setOpenTaskId(null)} />}
    {alerts.completion && <CompletionPopup key={alerts.completion.id} completion={alerts.completion} canStartBreak={!busy} onDismiss={alerts.dismiss} onStartBreak={startBreak} />}
  </div>;
}

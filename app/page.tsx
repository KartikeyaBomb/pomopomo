'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, CircleHelp, Coffee, Plus, RotateCcw, Shuffle, Trash2, Play, Pause, Timer as TimerIcon } from 'lucide-react';
import { BREAK_SECONDS, FOCUS_SECONDS, colors, pickTask, remaining, settleTimer, type Task, type Timer } from '../lib/pomodoro';

const KEY = 'pomopomo-v1';
const freshTimer: Timer = { taskId: null, mode: 'focus', remaining: FOCUS_SECONDS, deadline: null };
type State = { tasks: Task[]; timer: Timer };
const point = (angle: number, radius: number) => [180 + radius * Math.sin(angle * Math.PI / 180), 180 - radius * Math.cos(angle * Math.PI / 180)];

export default function Home() {
  const [state, setState] = useState<State>({ tasks: [], timer: freshTimer });
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(0);
  const [name, setName] = useState('');
  const [estimate, setEstimate] = useState('1');
  const [notice, setNotice] = useState('');
  const [storageError, setStorageError] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const spinTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const { tasks, timer } = state;
  const active = tasks.filter(task => remaining(task) > 0);
  const total = active.reduce((sum, task) => sum + remaining(task), 0);
  const completed = tasks.reduce((sum, task) => sum + task.done, 0);
  const selected = tasks.find(task => task.id === timer.taskId);
  const running = timer.deadline !== null;
  const busy = spinning || running || timer.remaining < (timer.mode === 'focus' ? FOCUS_SECONDS : BREAK_SECONDS);
  const seconds = running ? Math.max(0, Math.ceil((timer.deadline! - now) / 1000)) : timer.remaining;
  const time = `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        const validTasks = Array.isArray(saved.tasks) && saved.tasks.every((t: Task) => typeof t.id === 'string' && typeof t.name === 'string' && Number.isInteger(t.estimate) && t.estimate > 0 && t.estimate <= 999 && Number.isInteger(t.done) && t.done >= 0 && t.done <= t.estimate && colors.includes(t.color));
        const t = saved.timer;
        if (validTasks && t && ['focus', 'break'].includes(t.mode) && Number.isFinite(t.remaining) && t.remaining >= 0 && t.remaining <= (t.mode === 'focus' ? FOCUS_SECONDS : BREAK_SECONDS) && (t.deadline === null || Number.isFinite(t.deadline)) && (t.taskId === null || saved.tasks.some((task: Task) => task.id === t.taskId))) {
          const settled = settleTimer(saved.tasks, t, Date.now());
          setState({ tasks: settled.tasks, timer: settled.timer });
          if (settled.finished) setNotice(t.mode === 'focus' ? 'Pomodoro complete. Nice work! Take a little break.' : 'Break complete. Ready for a fresh start?');
        }
      }
    } catch { setStorageError(true); }
    setNow(Date.now()); setReady(true);
    return () => { if (spinTimeout.current) clearTimeout(spinTimeout.current); };
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { setStorageError(true); }
  }, [state, ready]);

  useEffect(() => {
    if (!running) return;
    const tick = () => {
      const current = Date.now(); setNow(current);
      if (timer.deadline! <= current) {
        setState(previous => { const result = settleTimer(previous.tasks, previous.timer, current); return { tasks: result.tasks, timer: result.timer }; });
        setNotice(timer.mode === 'focus' ? 'Pomodoro complete. Nice work! Take a little break.' : 'Break complete. Ready for a fresh start?');
      }
    };
    const interval = setInterval(tick, 250);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', tick); };
  }, [running, timer.deadline, timer.mode]);

  useEffect(() => { document.title = running ? `${time} · Pomopomo` : 'Pomopomo — a little focus goes a long way'; }, [running, time]);

  function select(task: Task) {
    if (busy) return;
    setState(previous => ({ ...previous, timer: { ...freshTimer, taskId: task.id } }));
    setNotice(`Up next: ${task.name}`);
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
      setNotice(`The wheel picked ${winner.name}. Let’s make a little progress.`); setSpinning(false);
    }, delay);
  }
  function toggleTimer() {
    if (spinning || (timer.mode === 'focus' && (!selected || !remaining(selected)))) return;
    const current = Date.now(); setNow(current); setNotice('');
    setState(previous => {
      const settled = settleTimer(previous.tasks, previous.timer, current);
      if (settled.finished) { setNotice('Session complete. Nice work!'); return { tasks: settled.tasks, timer: settled.timer }; }
      return { ...previous, timer: { ...previous.timer, deadline: running ? null : current + previous.timer.remaining * 1000, remaining: running ? Math.max(0, Math.ceil((previous.timer.deadline! - current) / 1000)) : previous.timer.remaining } };
    });
  }
  function resetTimer() { setState(previous => ({ ...previous, timer: { ...previous.timer, deadline: null, remaining: previous.timer.mode === 'focus' ? FOCUS_SECONDS : BREAK_SECONDS } })); }
  function changeMode(mode: 'focus' | 'break') { if (!busy) setState(previous => ({ ...previous, timer: { ...previous.timer, mode, remaining: mode === 'focus' ? FOCUS_SECONDS : BREAK_SECONDS } })); }
  function addTask(event: React.FormEvent) {
    event.preventDefault(); const count = Number(estimate);
    if (!name.trim() || !Number.isInteger(count) || count < 1 || count > 999 || spinning) return;
    setState(previous => ({ ...previous, tasks: [...previous.tasks, { id: crypto.randomUUID(), name: name.trim(), estimate: count, done: 0, color: colors[previous.tasks.length % colors.length] }] }));
    setName(''); setEstimate('1'); nameInput.current?.focus();
  }
  function removeTask(id: string) { setState(previous => ({ tasks: previous.tasks.filter(task => task.id !== id), timer: previous.timer.taskId === id ? freshTimer : previous.timer })); }
  function exampleTasks() { setState({ tasks: [{ id: crypto.randomUUID(), name: 'Task A', estimate: 5, done: 0, color: colors[0] }, { id: crypto.randomUUID(), name: 'Task B', estimate: 15, done: 0, color: colors[1] }], timer: freshTimer }); }
  let cursor = 0;

  return <div className="app-shell">
    <header className="topbar"><a href="/" className="brand" aria-label="Pomopomo home"><span className="brand-icon"><TimerIcon size={21} strokeWidth={1.8} /></span>pomo<span className="brand-light">pomo</span><span className="brand-dot">.</span></a><span className="header-note">A LITTLE FOCUS GOES A LONG WAY</span><button className="help-button" onClick={() => setShowHelp(!showHelp)} aria-expanded={showHelp}><CircleHelp size={17} /> How it works</button></header>
    <main>
      <div className="intro"><div><div className="eyebrow"><span /> ONE THING AT A TIME</div><h1>Less deciding.<br className="mobile-br" /> More doing.</h1><p>Make a little plan. Give it a spin. Find your focus.</p></div><div className="session-stat"><span className="stat-icon"><Check size={19} /></span><div><strong>{completed} <span>pomodoros</span></strong><small>completed from your list</small></div></div></div>
      {showHelp && <aside className="help-panel">Add your tasks and estimate how many 25-minute sessions each needs. Spin the wheel or select a task, then start the timer. Each completed session reduces its remaining count. Bigger remaining tasks get bigger slices: 5 out of 20 pomodoros = a 25% chance. Finished tasks leave the wheel. You can take a 5-minute break between sessions.</aside>}
      {storageError && <p role="alert" className="notice">Browser storage is unavailable. Keep this tab open to retain your progress.</p>}
      <div className="workspace">
        <section className="left-column">
          <section className="timer-card" aria-labelledby="timer-heading">
            <div className="card-top"><h2 id="timer-heading"><TimerIcon size={17} /> Your focus time</h2><span className="live-badge"><span /> {running ? 'IN THE ZONE' : 'A FRESH START'}</span></div>
            <div className="mode-switch"><button className={timer.mode === 'focus' ? 'active' : ''} disabled={busy} onClick={() => changeMode('focus')}>Pomodoro</button><button className={timer.mode === 'break' ? 'active' : ''} disabled={busy} onClick={() => changeMode('break')}><Coffee size={14} /> Short break</button></div>
            <div className="time" role="timer" aria-label={`${Math.floor(seconds / 60)} minutes ${seconds % 60} seconds remaining`}>{time}</div>
            <p className="focus-label">{timer.mode === 'break' ? 'Breathe. Stretch. Step away for a bit.' : selected && remaining(selected) ? <><span className="task-dot" style={{ background: selected.color }} />{selected.name}</> : 'Pick a task. Make these minutes yours.'}</p>
            <div className="timer-actions"><button className="primary start-button" disabled={!ready || spinning || (timer.mode === 'focus' && (!selected || !remaining(selected)))} onClick={toggleTimer}>{running ? <Pause size={17} fill="currentColor" /> : <Play size={16} fill="currentColor" />}{running ? 'Pause session' : timer.remaining < (timer.mode === 'focus' ? FOCUS_SECONDS : BREAK_SECONDS) ? 'Resume session' : timer.mode === 'break' ? 'Start break' : 'Start focusing'}</button><button className="reset-button" onClick={resetTimer} disabled={spinning} aria-label="Reset current timer" title="Reset current timer"><RotateCcw size={18} /></button></div>
            <p className="timer-footnote">{busy && !spinning ? 'Finish or reset this session to switch tasks.' : 'One pomodoro. One small step forward.'}</p>
          </section>
          <section className="tasks-card" aria-labelledby="tasks-heading"><div className="tasks-title"><h2 id="tasks-heading">Your to-do list <span>{active.length}</span></h2><span>{total} pomos left</span></div>
            <form className="add-form" onSubmit={addTask}><div className="task-field"><label htmlFor="task-name">What needs doing?</label><input id="task-name" ref={nameInput} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Read a chapter" maxLength={120} required disabled={!ready || spinning} /></div><div className="estimate-field"><label htmlFor="task-estimate">Pomos</label><input id="task-estimate" type="number" min="1" max="999" step="1" value={estimate} onChange={e => setEstimate(e.target.value)} required disabled={!ready || spinning} /></div><button className="add-button" disabled={!ready || spinning} aria-label="Add task" type="submit"><Plus size={21} /></button></form>
            <div className="task-list">{tasks.length === 0 ? <div className="empty-tasks"><div className="empty-icon"><Check size={21} /></div><strong>A little plan starts here.</strong><p>Add your first task above, or <button onClick={exampleTasks} disabled={!ready}>try an example</button>.</p></div> : tasks.map(task => <div className={`task-row ${task.id === timer.taskId ? 'selected' : ''} ${remaining(task) === 0 ? 'complete' : ''}`} key={task.id}><button className="task-select" disabled={busy || remaining(task) === 0} onClick={() => select(task)} aria-label={`Focus on ${task.name}`}><span className="task-marker" style={{ background: remaining(task) ? task.color : '#e9ede5' }}>{remaining(task) === 0 && <Check size={13} />}</span><span className="task-copy"><strong>{task.name}</strong><small>{task.done} of {task.estimate} pomos done{task.id === timer.taskId && remaining(task) > 0 && <span className="selected-label"> · Selected</span>}</small></span></button><span className="task-odds">{remaining(task) === 0 ? 'Done' : `${Number((remaining(task) / total * 100).toFixed(1))}%`}</span><button className="delete-button" disabled={spinning || (task.id === timer.taskId && busy)} onClick={() => removeTask(task.id)} aria-label={`Delete ${task.name}`}><Trash2 size={15} /></button></div>)}</div>
            <div className="list-footer"><TimerIcon size={13} /> 1 pomo = 25 minutes of focus<span>Saved on this browser</span></div>
          </section>
        </section>
        <section className="wheel-card" aria-labelledby="wheel-heading"><div className="wheel-heading"><span className="eyebrow">LET A LITTLE CHANCE HELP</span><h2 id="wheel-heading">What’s next?</h2><p>Your tasks. A spin. One less decision.</p></div>
          <div className="wheel-wrap"><span className="wheel-pointer" /><div className="wheel-shadow"><svg className="wheel" viewBox="0 0 360 360" role="img" aria-label={total ? `Task wheel, ${active.map(t => `${t.name}: ${Number((remaining(t) / total * 100).toFixed(1))}% chance`).join(', ')}` : 'Add tasks to fill your wheel'} style={{ transform: `rotate(${rotation}deg)` }}>{total === 0 ? <><circle cx="180" cy="180" r="175" fill="#eee7d8" /><path d="M180 5V355M5 180H355" stroke="#faf7ef" strokeWidth="3" /><path d="M56 56L304 304M56 304L304 56" stroke="#faf7ef" strokeWidth="3" /></> : active.map((task, index) => {
            const start = cursor; const angle = remaining(task) / total * 360; cursor += angle;
            const a = point(start, 175), b = point(cursor, 175), middle = start + angle / 2, label = point(middle, 112);
            return <g key={task.id}>{angle === 360 ? <circle cx="180" cy="180" r="175" fill={task.color} /> : <path d={`M180 180 L${a[0]} ${a[1]} A175 175 0 ${angle > 180 ? 1 : 0} 1 ${b[0]} ${b[1]} Z`} fill={task.color} stroke="#faf7ef" strokeWidth="2" />}{angle > 20 && <text x={label[0]} y={label[1]} transform={`rotate(${middle}, ${label[0]}, ${label[1]})`} textAnchor="middle" dominantBaseline="middle" fill="#40392d" fontSize="13" fontWeight="600">{task.name.length > 14 ? task.name.slice(0, 12) + '…' : task.name}</text>}</g>;
          })}</svg><div className="wheel-hub"><Shuffle size={24} strokeWidth={1.6} /></div></div></div>
          <button className="spin-button" disabled={!ready || total === 0 || busy} onClick={spin}><Shuffle size={18} />{spinning ? 'A little suspense…' : 'Spin to pick a task'}<ArrowRight size={17} /></button>
          <div className="wheel-result" aria-live="polite">{notice || (total === 0 ? tasks.length ? 'All done. That deserves a little celebration.' : 'Add a task to get the wheel turning.' : busy ? 'Your next spin can wait. You’ve got this.' : 'No overthinking required.')}</div>
          <div className="odds-note"><span className="odds-icon">%</span><div><strong>A fair share of your focus</strong><p>More pomodoros left = a bigger slice.<br />A 5-pomo task out of 20 gets a 25% chance.</p></div></div>
        </section>
      </div>
      <footer className="page-footer"><span>Small sessions. Steady progress.</span><span>Made for a little less overwhelm.<span className="footer-flower">✳</span></span></footer>
    </main>
  </div>;
}

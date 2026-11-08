'use client';
import { useEffect, useRef, useState } from 'react';
import { FileText, Play, X } from 'lucide-react';
import { FOCUS_SECONDS, type Task, type TaskChanges, type Timer } from '../lib/pomodoro';

type Props = {
  task: Task;
  timer: Timer;
  progress: number;
  busy: boolean;
  spinning: boolean;
  onSave: (changes: TaskChanges) => string | null;
  onFocus: () => void;
  onClose: () => void;
};
const fields = (task: Task) => ({ name: task.name, description: task.description ?? '', estimate: task.estimate });
export function TaskDetails({ task, timer, progress, busy, spinning, onSave, onFocus, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [original, setOriginal] = useState(() => fields(task));
  const [name, setName] = useState(task.name);
  const [description, setDescription] = useState(task.description ?? '');
  const [estimate, setEstimate] = useState(String(task.estimate));
  const [error, setError] = useState('');
  const [closing, setClosing] = useState(false);
  const closeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changedElsewhere = JSON.stringify(original) !== JSON.stringify(fields(task));
  const inSession = timer.mode === 'focus' && timer.taskId === task.id && (timer.deadline !== null || timer.remaining < FOCUS_SECONDS);
  const minimum = Math.max(1, task.done + (inSession ? 1 : 0));
  useEffect(() => {
    dialog.current?.showModal();
    return () => { if (closeTimeout.current) clearTimeout(closeTimeout.current); };
  }, []);
  function closePanel() {
    if (closing) return;
    const finish = () => { dialog.current?.close(); onClose(); };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
    setClosing(true);
    closeTimeout.current = setTimeout(finish, 180);
  }
  function reload() {
    setOriginal(fields(task)); setName(task.name); setDescription(task.description ?? ''); setEstimate(String(task.estimate)); setError('');
  }
  function save(event: React.FormEvent) {
    event.preventDefault();
    if (changedElsewhere || spinning || closing) return;
    const result = onSave({ name, description, estimate: Number(estimate) });
    if (result) setError(result);
    else closePanel();
  }
  return <dialog ref={dialog} className={`task-panel ${closing ? 'closing' : ''}`} aria-labelledby="task-panel-title" onCancel={event => { event.preventDefault(); closePanel(); }} onClick={event => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right) closePanel(); } }}>
    <div className="panel-top"><span><FileText size={15} /> Task details</span><button type="button" className="panel-close" aria-label="Close task details" onClick={closePanel}><X size={20} /></button></div>
    <form className="panel-form" onSubmit={save}>
      <h2 id="task-panel-title" className="sr-only">Edit task</h2>
      <label className="sr-only" htmlFor="edit-task-name">Task name</label>
      <input className="panel-title" id="edit-task-name" value={name} onChange={event => setName(event.target.value)} placeholder="Task name" maxLength={120} required />
      <div className="panel-properties"><label htmlFor="edit-task-estimate">Total pomodoros</label><input id="edit-task-estimate" type="number" min={minimum} max={999} step={1} value={estimate} onChange={event => setEstimate(event.target.value)} required /><span>Completed</span><span>{task.done} / {task.estimate}</span></div>
      <progress className="task-progress panel-progress" value={progress} max={1} aria-label="Task completion" />
      <label className="description-label" htmlFor="edit-task-description">Description</label>
      <textarea id="edit-task-description" value={description} onChange={event => setDescription(event.target.value)} placeholder="Add a description…" maxLength={5000} rows={8} />
      {inSession && <p className="panel-hint">Total includes completed pomodoros and the current session.</p>}
      {changedElsewhere && <div className="panel-error" role="alert">This task changed on another device. <button type="button" onClick={reload}>Reload task</button></div>}
      {error && <p className="panel-error" role="alert">{error}</p>}
      <div className="panel-actions"><button className="panel-cancel" type="button" onClick={closePanel}>Cancel</button><button type="submit" className="primary" disabled={spinning || changedElsewhere || closing}>Save changes</button></div>
      <button className="panel-focus" type="button" onClick={() => { onFocus(); closePanel(); }} disabled={busy || task.done >= task.estimate || name !== original.name || description !== original.description || estimate !== String(original.estimate)}><Play size={14} /> Focus on task</button>
    </form>
  </dialog>;
}

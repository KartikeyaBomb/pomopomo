'use client';
import { useEffect, useRef } from 'react';
import { Check, Coffee } from 'lucide-react';
import type { Completion } from '../lib/pomodoro';

export function CompletionPopup({ completion, canStartBreak, onDismiss, onStartBreak }: {
  completion: Completion; canStartBreak: boolean; onDismiss: () => void; onStartBreak: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  function dismiss() { dialog.current?.close(); onDismiss(); }
  const focus = completion.mode === 'focus';
  return <dialog ref={dialog} className="completion-popup" role="alertdialog" aria-labelledby="completion-title" aria-describedby="completion-description" onCancel={event => { event.preventDefault(); dismiss(); }}>
    <span className="completion-icon">{focus ? <Check size={26} /> : <Coffee size={26} />}</span>
    <h2 id="completion-title">{focus ? 'Pomodoro complete' : 'Break complete'}</h2>
    <p id="completion-description">{focus ? completion.taskName ?? 'Focus session finished.' : 'Ready for your next pomodoro.'}</p>
    <div className="completion-actions"><button className="panel-cancel" autoFocus onClick={dismiss}>Dismiss</button>{focus && <button className="primary" disabled={!canStartBreak} onClick={() => { dismiss(); onStartBreak(); }}>Start 5-minute break</button>}</div>
  </dialog>;
}

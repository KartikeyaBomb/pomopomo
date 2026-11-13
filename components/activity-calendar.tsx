'use client';
import { useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Copy, Check } from 'lucide-react';
import { activityDate, activityDayRange, dateKey, dayLogLines, formatDayLog, type Activity } from '../lib/activity';

type Props = { date: Date | null; onDateChange: (date: Date) => void; entries: Activity[]; status: string; pendingCount: number; storageError: boolean };
const duration = (minutes: number) => minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}` : `${minutes}m`;
export function ActivityCalendar({ date, onDateChange, entries, status, pendingCount, storageError }: Props) {
  const [copied, setCopied] = useState('');
  const textArea = useRef<HTMLTextAreaElement>(null);
  if (!date) return <section className="history-card" aria-label="Activity history"><h2>History</h2><p>Loading…</p></section>;
  const selected = dateKey(date), { start, end } = activityDayRange(date);
  const lines = dayLogLines(entries, date), text = formatDayLog(lines);
  const daily = entries.filter(entry => entry.completedAt >= start && entry.completedAt < end);
  const focusMinutes = Math.round(lines.reduce((sum, line) => sum + line.end - line.start, 0) / 60000);
  function move(offset: number) { onDateChange(new Date(date!.getFullYear(), date!.getMonth(), date!.getDate() + offset, 12)); setCopied(''); }
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied('Copied'); }
    catch { textArea.current?.focus(); textArea.current?.select(); setCopied('Text selected — copy it manually.'); }
  }
  return <section className="history-card" aria-labelledby="history-title">
    <div className="history-header"><h2 id="history-title"><CalendarDays size={18} /> History</h2><span role="status">{status === 'loading' ? 'Loading…' : status === 'signin' ? 'Sign in to sync' : status === 'offline' ? 'Offline · saved history' : pendingCount ? 'Saving…' : 'Synced'}</span></div>
    <div className="day-navigation">
      <button aria-label="Previous day" onClick={() => move(-1)}><ChevronLeft size={18} /></button>
      <label className="history-date"><span>{date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span><input aria-label="History date" type="date" value={selected} onChange={event => { if (event.target.value) { onDateChange(new Date(`${event.target.value}T12:00:00`)); setCopied(''); } }} /></label>
      <button aria-label="Next day" onClick={() => move(1)}><ChevronRight size={18} /></button>
      <button className="history-today" onClick={() => { onDateChange(activityDate(new Date())); setCopied(''); }}>Today</button>
    </div>
    <div className="history-stats" aria-label="Day totals"><div><strong>{daily.filter(entry => entry.mode === 'focus').length}</strong><span>Pomodoros</span></div><div><strong>{duration(focusMinutes)}</strong><span>Focus time</span></div><div><strong>{daily.filter(entry => entry.mode === 'break').length}</strong><span>Breaks</span></div></div>
    <div className="day-log-toolbar"><span>8 AM – 8 AM · completed work</span><button className="copy-day" disabled={!text || status === 'loading'} onClick={copy}>{copied === 'Copied' ? <Check size={14} /> : <Copy size={14} />}{copied === 'Copied' ? 'Copied' : 'Copy day'}</button></div>
    {text ? <textarea ref={textArea} className="day-log-text" aria-label="Copyable day activity log" value={text} readOnly spellCheck={false} /> : <p className="history-empty">{status === 'loading' ? 'Loading sessions…' : status === 'offline' ? 'No saved completed work for this day.' : 'No completed work for this day.'}</p>}
    {copied && <span className="copy-status" role="status">{copied}</span>}
    {lines.some(line => line.estimated) && <p className="history-timing-note">Older session times are estimated from their finish times; pauses weren’t recorded.</p>}
    {storageError && <p className="history-warning" role="alert">Browser storage is unavailable. Keep this tab open until history syncs.</p>}
  </section>;
}

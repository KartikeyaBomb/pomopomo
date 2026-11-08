'use client';
import { CalendarDays, ChevronLeft, ChevronRight, Coffee, Timer } from 'lucide-react';
import { activityTotals, dateKey, type Activity } from '../lib/activity';

type Props = { date: Date | null; onDateChange: (date: Date) => void; entries: Activity[]; status: string; pendingCount: number; storageError: boolean };
const duration = (minutes: number) => minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}` : `${minutes}m`;
export function ActivityCalendar({ date, onDateChange, entries, status, pendingCount, storageError }: Props) {
  if (!date) return <section className="history-card" aria-label="Activity history"><h2>History</h2><p>Loading…</p></section>;
  const selected = dateKey(date);
  const selectedEntries = entries.filter(entry => dateKey(new Date(entry.completedAt)) === selected);
  const daily = activityTotals(selectedEntries);
  function move(offset: number) { onDateChange(new Date(date!.getFullYear(), date!.getMonth(), date!.getDate() + offset, 12)); }
  return <section className="history-card" aria-labelledby="history-title">
    <div className="history-header"><h2 id="history-title"><CalendarDays size={18} /> History</h2><span role="status">{status === 'loading' ? 'Loading…' : status === 'signin' ? 'Sign in to sync' : status === 'offline' ? 'Offline' : pendingCount ? 'Saving…' : 'Synced'}</span></div>
    <div className="day-navigation">
      <button aria-label="Previous day" onClick={() => move(-1)}><ChevronLeft size={18} /></button>
      <label className="history-date"><span>{date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span><input aria-label="History date" type="date" value={selected} onChange={event => { if (event.target.value) onDateChange(new Date(`${event.target.value}T12:00:00`)); }} /></label>
      <button aria-label="Next day" onClick={() => move(1)}><ChevronRight size={18} /></button>
      <button className="history-today" onClick={() => onDateChange(new Date())}>Today</button>
    </div>
    <div className="history-stats" aria-label="Day totals"><div><strong>{daily.pomodoros}</strong><span>Pomodoros</span></div><div><strong>{duration(daily.focusMinutes)}</strong><span>Focus time</span></div><div><strong>{daily.breaks}</strong><span>Breaks</span></div></div>
    <div className="day-history" aria-label="Selected day activity">{selectedEntries.length === 0 ? <p className="history-empty">{status === 'loading' ? 'Loading sessions…' : status === 'offline' ? 'No saved sessions for this day.' : 'No completed sessions.'}</p> : <ol tabIndex={0} aria-label="Completed sessions">{selectedEntries.map(entry => <li key={entry.id}><span className={`history-event-icon ${entry.mode}`}>{entry.mode === 'focus' ? <Timer size={15} /> : <Coffee size={15} />}</span><div><strong>{entry.mode === 'focus' ? entry.taskName ?? 'Focus session' : 'Short break'}</strong><span>{entry.durationSeconds / 60} min · <time dateTime={new Date(entry.completedAt).toISOString()}>{new Date(entry.completedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</time></span></div></li>)}</ol>}</div>
    {storageError && <p className="history-warning" role="alert">Browser storage is unavailable. Keep this tab open until history syncs.</p>}
  </section>;
}

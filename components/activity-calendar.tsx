'use client';
import { useEffect, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Coffee, Timer } from 'lucide-react';
import { activityTotals, calendarDays, dateKey, type Activity } from '../lib/activity';

type Props = { month: Date | null; onMonthChange: (date: Date) => void; entries: Activity[]; status: string; pendingCount: number; storageError: boolean };
const duration = (minutes: number) => minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}` : `${minutes}m`;
export function ActivityCalendar({ month, onMonthChange, entries, status, pendingCount, storageError }: Props) {
  const [selected, setSelected] = useState('');
  const [zone, setZone] = useState('');
  useEffect(() => { setSelected(dateKey(new Date())); setZone(Intl.DateTimeFormat().resolvedOptions().timeZone); }, []);
  if (!month) return <section className="history-card" aria-label="Activity history"><h2>History</h2><p>Loading calendar…</p></section>;
  const today = dateKey(new Date());
  const totals = activityTotals(entries);
  const days = calendarDays(month);
  const selectedEntries = entries.filter(entry => dateKey(new Date(entry.completedAt)) === selected);
  const daily = activityTotals(selectedEntries);
  const byDay = new Map<string, Activity[]>();
  for (const entry of entries) { const day = dateKey(new Date(entry.completedAt)); byDay.set(day, [...(byDay.get(day) ?? []), entry]); }
  function move(offset: number) { const next = new Date(month!.getFullYear(), month!.getMonth() + offset, 1, 12); onMonthChange(next); setSelected(dateKey(next)); }
  function select(date: Date) { setSelected(dateKey(date)); if (date.getMonth() !== month!.getMonth() || date.getFullYear() !== month!.getFullYear()) onMonthChange(new Date(date.getFullYear(), date.getMonth(), 1, 12)); }
  const selectedDate = selected ? new Date(`${selected}T12:00:00`) : new Date();
  return <section className="history-card" aria-labelledby="history-title">
    <div className="history-header"><h2 id="history-title"><CalendarDays size={19} /> History</h2><span role="status">{status === 'loading' ? 'Loading…' : status === 'signin' ? 'Sign in to sync history' : status === 'offline' ? 'Offline · showing saved history' : pendingCount ? 'Saving sessions…' : 'Synced'}{pendingCount > 0 && ` · ${pendingCount} pending`}</span></div>
    <div className="history-stats" aria-label="Month totals"><div><strong>{totals.pomodoros}</strong><span>Pomodoros</span></div><div><strong>{duration(totals.focusMinutes)}</strong><span>Focus time</span></div><div><strong>{totals.activeDays}</strong><span>Focus days</span></div><div><strong>{totals.breaks}</strong><span>Breaks</span></div></div>
    <div className="history-layout"><div className="calendar-area"><div className="calendar-toolbar"><h3>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h3><div><button aria-label="Previous month" onClick={() => move(-1)}><ChevronLeft size={17} /></button><button className="calendar-today" onClick={() => { const now = new Date(); onMonthChange(new Date(now.getFullYear(), now.getMonth(), 1, 12)); setSelected(dateKey(now)); }}>Today</button><button aria-label="Next month" onClick={() => move(1)}><ChevronRight size={17} /></button></div></div>
      <div className="calendar-grid" aria-label="Choose a date">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <span className="weekday" key={day}>{day}</span>)}{days.map(date => {
        const key = dateKey(date), items = byDay.get(key) ?? [], count = items.filter(entry => entry.mode === 'focus').length;
        const outside = date.getMonth() !== month.getMonth();
        return <button key={key} className={`calendar-day level-${Math.min(3, count)} ${outside ? 'outside' : ''} ${key === selected ? 'chosen' : ''} ${key === today ? 'today' : ''}`} onClick={() => select(date)} aria-pressed={key === selected} aria-current={key === today ? 'date' : undefined} aria-label={`${date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}${outside ? '' : `, ${count} pomodoros, ${items.length - count} breaks`}`}><span>{date.getDate()}</span>{!outside && items.length > 0 && <small>{count ? <>{count}<span className="calendar-unit"> pomo{count !== 1 ? 's' : ''}</span></> : <Coffee size={12} />}</small>}</button>;
      })}</div>
      <p className="history-footnote">Completed sessions only · {zone}</p>
    </div><aside className="day-history" aria-label="Selected day activity"><h3>{selectedDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</h3><p className="day-totals">{daily.pomodoros} pomodoros · {duration(daily.focusMinutes)} focus</p>{selectedEntries.length === 0 ? <p className="history-empty">{status === 'loading' ? 'Loading sessions…' : status === 'offline' ? 'No saved sessions for this day.' : 'No completed sessions.'}</p> : <ol>{selectedEntries.map(entry => <li key={entry.id}><span className={`history-event-icon ${entry.mode}`}>{entry.mode === 'focus' ? <Timer size={15} /> : <Coffee size={15} />}</span><div><strong>{entry.mode === 'focus' ? entry.taskName ?? 'Focus session' : 'Short break'}</strong><span>{entry.durationSeconds / 60} min · completed <time dateTime={new Date(entry.completedAt).toISOString()}>{new Date(entry.completedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</time></span></div></li>)}</ol>}</aside></div>
    {storageError && <p className="history-warning" role="alert">Browser storage is unavailable. Keep this tab open until history syncs.</p>}
    <p className="history-footnote">History starts with sessions completed after this update. Earlier counts have no recorded dates.</p>
  </section>;
}

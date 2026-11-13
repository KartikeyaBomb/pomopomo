'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { activitySchema, mergeActivity, activityDayRange, activityIntersects, type Activity } from '../lib/activity';
const OUTBOX = 'pomopomo-history-outbox-v1';
export function useActivityHistory(month: Date | null) {
  const [cached, setCached] = useState<Activity[]>([]);
  const [pending, setPending] = useState<Activity[]>([]);
  const [status, setStatus] = useState<'loading' | 'synced' | 'offline' | 'signin'>('loading');
  const [storageError, setStorageError] = useState(false);
  const outbox = useRef<Activity[]>([]);
  const trigger = useRef<() => void>(() => {});
  const { start, end } = month ? activityDayRange(month) : { start: 0, end: 0 };
  const persistPending = useCallback(() => {
    setPending([...outbox.current]);
    try { localStorage.setItem(OUTBOX, JSON.stringify(outbox.current)); } catch { setStorageError(true); }
  }, []);
  useEffect(() => {
    try { outbox.current = z.array(activitySchema).parse(JSON.parse(localStorage.getItem(OUTBOX) ?? '[]')); setPending(outbox.current); } catch { setStorageError(true); }
  }, []);
  const record = useCallback((entry: Activity) => {
    if (outbox.current.some(item => item.id === entry.id)) return;
    outbox.current = mergeActivity(outbox.current, [entry]);
    // Persist the completion before the timer is settled, so reloads can retry it.
    persistPending(); trigger.current();
  }, [persistPending]);
  useEffect(() => {
    if (!end) return;
    let disposed = false, inFlight = false;
    const controller = new AbortController();
    const key = `pomopomo-history-day-v2-${start}`;
    const inRange = (entry: Activity) => activityIntersects(entry, start, end);
    let known: Activity[] = [];
    try { known = z.array(activitySchema).parse(JSON.parse(localStorage.getItem(key) ?? '[]')).filter(inRange); } catch { /* Empty month cache. */ }
    setCached(known);
    const cache = (entries: Activity[]) => {
      known = entries; setCached(entries);
      try { localStorage.setItem(key, JSON.stringify(entries)); } catch { setStorageError(true); }
    };
    setStatus('loading');
    const sync = async () => {
      if (disposed || inFlight) return;
      if (!navigator.onLine) { setStatus('offline'); return; }
      inFlight = true;
      try {
        // Small idempotent batches keep long offline runs safe to retry.
        while (outbox.current.length && !disposed) {
          const batch = outbox.current.slice(0, 50);
          const response = await fetch('/api/history', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries: batch }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
          if (disposed) return;
          if (response.status === 401 || response.redirected) { setStatus('signin'); return; }
          if (!response.ok) throw new Error('Unable to save history');
          const result = z.object({ savedIds: z.array(z.string()) }).parse(await response.json());
          if (disposed) return;
          const saved = new Set(result.savedIds);
          if (!batch.every(entry => saved.has(entry.id))) throw new Error('Incomplete history upload');
          cache(mergeActivity(known, batch.filter(inRange)));
          outbox.current = outbox.current.filter(entry => !saved.has(entry.id)); persistPending();
        }
        const response = await fetch(`/api/history?start=${start}&end=${end}&timeline=1`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        if (disposed) return;
        if (response.status === 401 || response.redirected) { setStatus('signin'); return; }
        if (!response.ok) throw new Error('Unable to load history');
        const result = z.object({ entries: z.array(activitySchema) }).parse(await response.json());
        if (disposed) return;
        cache(result.entries); setStatus('synced');
      } catch { if (!disposed) setStatus('offline'); }
      finally { inFlight = false; }
    };
    trigger.current = () => { void sync(); };
    const visible = () => { if (document.visibilityState === 'visible') void sync(); };
    const offline = () => setStatus('offline');
    const interval = setInterval(sync, 5000);
    window.addEventListener('online', sync); window.addEventListener('offline', offline); document.addEventListener('visibilitychange', visible);
    void sync();
    return () => { disposed = true; controller.abort(); clearInterval(interval); trigger.current = () => {}; window.removeEventListener('online', sync); window.removeEventListener('offline', offline); document.removeEventListener('visibilitychange', visible); };
  }, [start, end, persistPending]);
  return { entries: mergeActivity(cached, pending).filter(entry => activityIntersects(entry, start, end)), status, storageError, pendingCount: pending.length, record };
}

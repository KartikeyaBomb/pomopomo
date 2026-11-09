'use client';
import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { z } from 'zod';
import { stateSchema, type AppState } from '../lib/state-schema';
import type { TimerAction } from '../lib/timer-actions';
import { FOCUS_SECONDS } from '../lib/pomodoro';
const KEY = 'pomopomo-v1';
const initial: AppState = { tasks: [], timer: { taskId: null, mode: 'focus', remaining: FOCUS_SECONDS, deadline: null } };
type Remote = { state: AppState | null; revision: number };
type Snapshot = { state: AppState; revision: number; dirty: boolean; generation: number };
export type SyncStatus = 'connecting' | 'synced' | 'syncing' | 'offline' | 'signin' | 'conflict';

export function useSyncedState() {
  const [state, renderState] = useState<AppState>(initial);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<SyncStatus>('connecting');
  const [storageError, setStorageError] = useState(false);
  const [conflict, showConflict] = useState<Remote | null>(null);
  const current = useRef<Snapshot>({ state: initial, revision: 0, dirty: false, generation: 0 });
  const conflictRef = useRef<Remote | null>(null);
  const inFlight = useRef(false);
  const [commandBusy, setCommandBusy] = useState(false);
  const commandLock = useRef(false);
  const trigger = useRef<() => void>(() => {});
  const persist = useCallback(() => {
    try { localStorage.setItem(KEY, JSON.stringify(current.current)); } catch { setStorageError(true); }
  }, []);
  const setState = useCallback((action: SetStateAction<AppState>) => {
    const previous = current.current;
    const next = typeof action === 'function' ? action(previous.state) : action;
    if (JSON.stringify(next) === JSON.stringify(previous.state)) return;
    current.current = { ...previous, state: next, dirty: true, generation: previous.generation + 1 };
    renderState(next); persist();
    if (!conflictRef.current) setStatus(navigator.onLine ? 'syncing' : 'offline');
    trigger.current();
  }, [persist]);

  useEffect(() => {
    let disposed = false;
    let scheduled: ReturnType<typeof setTimeout> | undefined;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        const parsed = stateSchema.safeParse(saved.state ?? saved);
        if (parsed.success) {
          current.current = { state: parsed.data, revision: Number.isSafeInteger(saved.revision) && saved.revision >= 0 ? saved.revision : 0, dirty: saved.state ? saved.dirty === true : parsed.data.tasks.length > 0, generation: 0 };
          renderState(parsed.data);
        }
      }
    } catch { setStorageError(true); }
    setReady(true);
    const sync = async () => {
      if (disposed || inFlight.current || commandLock.current || conflictRef.current) return;
      if (!navigator.onLine) { setStatus('offline'); return; }
      inFlight.current = true;
      const snapshot = current.current;
      try {
        const response = await fetch('/api/state', {
          method: snapshot.dirty ? 'PUT' : 'GET', credentials: 'same-origin', cache: 'no-store',
          headers: snapshot.dirty ? { 'Content-Type': 'application/json' } : {},
          body: snapshot.dirty ? JSON.stringify({ state: snapshot.state, revision: snapshot.revision }) : undefined,
          signal: AbortSignal.timeout(10000),
        });
        if (disposed) return;
        if (response.status === 401 || response.redirected) { setStatus('signin'); return; }
        if (!response.ok && response.status !== 409) throw new Error('Sync unavailable');
        const result = z.object({ revision: z.number().int().nonnegative(), state: stateSchema.nullable().optional() }).parse(await response.json());
        if (!Number.isSafeInteger(result.revision) || result.revision < 0) throw new Error('Invalid sync response');
        if ((!snapshot.dirty || response.status === 409) && result.state !== null && !stateSchema.safeParse(result.state).success) throw new Error('Invalid remote state');
        if (response.status === 409) {
          if (JSON.stringify(current.current.state) === JSON.stringify(result.state)) {
            current.current = { ...current.current, revision: result.revision, dirty: false };
            persist(); setStatus('synced');
          } else {
            const remote = { revision: result.revision, state: result.state ?? null };
            conflictRef.current = remote; showConflict(remote); setStatus('conflict');
          }
          return;
        }
        if (snapshot.dirty) {
          const unchanged = current.current.generation === snapshot.generation;
          current.current = { ...current.current, state: unchanged && result.state ? result.state : current.current.state, revision: result.revision, dirty: !unchanged };
          if (unchanged && result.state) renderState(result.state);
        } else if (current.current.generation === snapshot.generation) {
          const next = result.state ?? current.current.state;
          current.current = { ...current.current, state: next, revision: result.revision, dirty: false };
          if (JSON.stringify(snapshot.state) !== JSON.stringify(next)) renderState(next);
        }
        persist();
        setStatus(current.current.dirty ? 'syncing' : 'synced');
      } catch { if (!disposed) setStatus('offline'); }
      finally {
        inFlight.current = false;
      }
    };
    const schedule = () => { clearTimeout(scheduled); scheduled = setTimeout(sync, 250); };
    trigger.current = schedule;
    const visible = () => { if (document.visibilityState === 'visible') void sync(); };
    const offline = () => setStatus('offline');
    const interval = setInterval(sync, 5000);
    window.addEventListener('online', sync); window.addEventListener('offline', offline);
    window.addEventListener('focus', visible); document.addEventListener('visibilitychange', visible);
    void sync();
    return () => {
      disposed = true; clearInterval(interval); clearTimeout(scheduled);
      window.removeEventListener('online', sync); window.removeEventListener('offline', offline);
      window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible);
      trigger.current = () => {};
    };
  }, [persist]);

  async function command(action: TimerAction) {
    if (commandLock.current || inFlight.current || current.current.dirty || conflictRef.current) throw new Error('Wait for tasks to sync before controlling the timer.');
    if (!navigator.onLine) throw new Error('Connect to Wi-Fi to control the shared timer.');
    commandLock.current = true; setCommandBusy(true);
    const input = { commandId: crypto.randomUUID(), revision: current.current.revision, action };
    const snapshot = current.current;
    try {
      let response: Response | undefined;
      // An ambiguous timeout is retried with the SAME ID and revision.
      for (let attempt = 0; attempt < 2; attempt++) {
        try { response = await fetch('/api/timer', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(10000) }); break; }
        catch (error) { if (attempt === 1) throw error; }
      }
      const result = z.object({ state: stateSchema.optional(), revision: z.number().int().optional(), error: z.string().optional() }).parse(await response!.json());
      if (result.state && result.revision !== undefined && Number.isSafeInteger(result.revision)) {
        if (current.current.generation === snapshot.generation) {
          current.current = { state: result.state, revision: result.revision, dirty: false, generation: snapshot.generation + 1 };
          renderState(result.state); persist(); setStatus('synced');
        } else {
          const remote = { state: result.state, revision: result.revision }; conflictRef.current = remote; showConflict(remote); setStatus('conflict');
        }
      }
      if (!response!.ok && !(response!.status === 409 && action.type === 'settle')) throw new Error(result.error || 'Timer changed on another device. Try again.');
    } finally { commandLock.current = false; setCommandBusy(false); trigger.current(); }
  }

  function resolveConflict(useDevice: boolean) {
    const remote = conflictRef.current;
    if (!remote) return;
    const next = useDevice ? { ...current.current.state, timer: remote.state?.timer ?? initial.timer } : remote.state ?? initial;
    // Preserve the discarded copy locally so either choice is recoverable.
    try { localStorage.setItem('pomopomo-conflict-backup', JSON.stringify(useDevice ? remote.state : current.current.state)); } catch { setStorageError(true); }
    current.current = { state: next, revision: remote.revision, dirty: useDevice, generation: current.current.generation + 1 };
    renderState(next); persist(); conflictRef.current = null; showConflict(null);
    setStatus(useDevice ? 'syncing' : 'synced'); trigger.current();
  }
  return { state, setState, command, commandBusy, ready, storageError, status, conflict, resolveConflict };
}

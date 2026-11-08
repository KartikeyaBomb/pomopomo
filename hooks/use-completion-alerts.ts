'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Completion } from '../lib/pomodoro';

const KEY = 'pomopomo-alerts-v1';
type Preferences = { sound: boolean; notifications: boolean; lastId: string | null; pending: Completion | null };
const initial: Preferences = { sound: true, notifications: false, lastId: null, pending: null };
export function useCompletionAlerts() {
  const preferences = useRef<Preferences>(initial);
  const [settings, setSettings] = useState(initial);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('unsupported');
  const [message, setMessage] = useState('');
  const audio = useRef<AudioContext | null>(null);
  const persist = useCallback((next: Preferences) => {
    preferences.current = next; setSettings(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* Alerts still work without browser storage. */ }
  }, []);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (saved && typeof saved.sound === 'boolean' && typeof saved.notifications === 'boolean') {
        const pending = saved.pending;
        const validPending = pending && typeof pending.id === 'string' && ['focus', 'break'].includes(pending.mode) && (pending.taskName === null || typeof pending.taskName === 'string');
        const next = { sound: saved.sound, notifications: saved.notifications, lastId: typeof saved.lastId === 'string' ? saved.lastId : null, pending: validPending ? pending as Completion : null };
        preferences.current = next; setSettings(next);
      }
    } catch { /* Ignore corrupt preferences. */ }
    const refresh = () => setPermission('Notification' in window ? Notification.permission : 'unsupported');
    refresh(); window.addEventListener('focus', refresh);
    return () => { window.removeEventListener('focus', refresh); void audio.current?.close().catch(() => {}); audio.current = null; };
  }, []);

  const prepareSound = useCallback(() => {
    if (!preferences.current.sound) return;
    try {
      const Audio = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Audio) return;
      audio.current ??= new Audio();
      void audio.current.resume().catch(() => {});
    } catch { /* Some devices block audio; the popup remains available. */ }
  }, []);

  const announce = useCallback((completion: Completion) => {
    if (preferences.current.lastId === completion.id) return;
    const next = { ...preferences.current, lastId: completion.id, pending: completion };
    persist(next);
    const context = audio.current;
    if (next.sound && context?.state === 'running') {
      try {
        [660, 880, 990].forEach((frequency, index) => {
          const oscillator = context.createOscillator(); const gain = context.createGain();
          const start = context.currentTime + index * 0.23;
          oscillator.type = 'sine'; oscillator.frequency.value = frequency;
          gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(0.12, start + 0.02); gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
          oscillator.connect(gain); gain.connect(context.destination);
          oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
          oscillator.start(start); oscillator.stop(start + 0.36);
        });
      } catch { /* The popup must not depend on sound playback. */ }
    }
    if (next.notifications && 'Notification' in window && Notification.permission === 'granted') {
      void (async () => {
        const title = completion.mode === 'focus' ? 'Pomodoro complete' : 'Break complete';
        const options: NotificationOptions = {
          body: completion.mode === 'focus' ? `${completion.taskName ?? 'Focus session'} — time for a break.` : 'Ready for your next pomodoro.',
          icon: '/icons/icon-192.png', tag: `pomopomo-${completion.id}`,
        };
        try {
          const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
          if (registration?.active) await registration.showNotification(title, options);
          else {
            const notification = new Notification(title, options);
            notification.onclick = () => { window.focus(); notification.close(); };
          }
        } catch { setMessage('Browser notification unavailable. The completion popup is still active.'); }
      })();
    }
  }, [persist]);

  function toggleSound() {
    const next = { ...preferences.current, sound: !preferences.current.sound };
    persist(next); if (next.sound) prepareSound();
  }
  async function toggleNotifications() {
    setMessage('');
    if (preferences.current.notifications) { persist({ ...preferences.current, notifications: false }); return; }
    if (!('Notification' in window)) { setMessage('Browser notifications are unavailable here. The popup still works.'); return; }
    try {
      const result = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      setPermission(result);
      persist({ ...preferences.current, notifications: result === 'granted' });
      if (result === 'denied') setMessage('Notifications are blocked. Allow them in your browser’s site settings.');
      if (result === 'default') setMessage('Permission wasn’t granted. The popup still works.');
    } catch { setMessage('Open the installed app or a full browser tab to enable notifications.'); }
  }
  return {
    completion: settings.pending, sound: settings.sound,
    notifications: settings.notifications && permission === 'granted', permission, message,
    announce, prepareSound, toggleSound, toggleNotifications,
    dismiss: () => persist({ ...preferences.current, pending: null }),
  };
}

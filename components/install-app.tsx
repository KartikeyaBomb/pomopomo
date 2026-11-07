'use client';
import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
export function InstallApp() {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [help, setHelp] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  useEffect(() => {
    setInstalled(window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    const before = (event: Event) => { event.preventDefault(); setPrompt(event as InstallEvent); };
    const complete = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', before);
    window.addEventListener('appinstalled', complete);
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).then(() => setOfflineReady(true)).catch(() => setOfflineReady(false));
    }
    return () => { window.removeEventListener('beforeinstallprompt', before); window.removeEventListener('appinstalled', complete); };
  }, []);
  async function install() {
    if (prompt) { await prompt.prompt(); await prompt.userChoice; setPrompt(null); }
    else setHelp(!help);
  }
  return <div className="install-wrap">{!installed && <button className="help-button install-button" onClick={install}><Download size={16} /> Install app</button>}{help && <div className="install-help" role="dialog" aria-label="Install Pomopomo"><button aria-label="Close install instructions" onClick={() => setHelp(false)}><X size={16} /></button><strong>Your focus, on your phone.</strong><p><b>iPhone:</b> open this link in Safari, tap Share, then Add to Home Screen.</p><p><b>Android:</b> open in Chrome, tap the menu, then Install app or Add to Home screen.</p><p>Sign in with the same account on each device to sync tasks and your timer.</p><small>{offlineReady ? 'Ready to open offline on this device.' : 'Open once online to prepare this device for offline use.'} Offline changes sync when you reopen the app online.</small></div>}</div>;
}

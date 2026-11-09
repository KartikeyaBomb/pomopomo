'use client';
import { useState } from 'react';
type Device = { id: string; name: string; revoked_at: number | null; paired_at: number | null };
export function DeviceSettings() {
  const [devices, setDevices] = useState<Device[]>([]), [code, setCode] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function load() { try { const r = await fetch('/api/devices'); if (!r.ok) throw new Error('Sign in to manage devices.'); setDevices((await r.json() as { devices: Device[] }).devices); } catch (e) { setError((e as Error).message); } }
  async function create() { setBusy(true); setError(''); try { const r = await fetch('/api/devices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'E-paper Pomopomo' }) }); const data = await r.json() as { error: string; pairingCode: string }; if (!r.ok) throw new Error(data.error); setCode(data.pairingCode); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function revoke(id: string) { const r = await fetch('/api/devices', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); if (r.ok) { setCode(''); await load(); } else setError('Could not revoke device. Try again.'); }
  return <details className="device-settings" onToggle={e => { if (e.currentTarget.open) void load(); }}><summary>E-paper devices</summary><button disabled={busy} onClick={create}>Pair a device</button>{code && <p>Pairing code (expires in 10 minutes): <code style={{ overflowWrap: 'anywhere' }}>{code}</code></p>}<ul>{devices.map(d => <li key={d.id}>{d.name} · {d.revoked_at ? 'Revoked' : d.paired_at ? 'Paired' : 'Awaiting pairing'} {!d.revoked_at && <button onClick={() => revoke(d.id)}>Revoke</button>}</li>)}</ul>{error && <p role="alert">{error}</p>}</details>;
}

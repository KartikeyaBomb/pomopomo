import { getChatGPTUser } from '../../chatgpt-auth';
import { reply, db, sameOrigin, jsonBody } from '../../../lib/server/api';
import { digest } from '../../../lib/server/shared-state';
import { z } from 'zod';
export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return reply({ error: 'Sign in required' }, 401);
  const rows = await db().prepare('SELECT id,name,created_at,paired_at,revoked_at FROM devices WHERE user_id=? ORDER BY created_at DESC').bind(user.userId).all();
  return reply({ devices: rows.results });
}
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return reply({ error: 'Sign in required' }, 401);
  if (!sameOrigin(request)) return reply({ error: 'Invalid origin' }, 403);
  let parsed; try { parsed = z.object({ name: z.string().trim().min(1).max(60) }).safeParse(await jsonBody(request)); } catch { return reply({ error: 'Invalid request' }, 400); }
  if (!parsed.success) return reply({ error: 'Enter a device name' }, 400);
  const id = crypto.randomUUID(), code = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  const expiresAt = Date.now() + 600000;
  await db().prepare('INSERT INTO devices(id,user_id,name,pairing_hash,pairing_expires,created_at) VALUES(?,?,?,?,?,?)').bind(id, user.userId, parsed.data.name, await digest(code), expiresAt, Date.now()).run();
  return reply({ id, pairingCode: code, expiresAt });
}
export async function DELETE(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return reply({ error: 'Sign in required' }, 401);
  if (!sameOrigin(request)) return reply({ error: 'Invalid origin' }, 403);
  let input; try { input = z.object({ id: z.string().uuid() }).parse(await jsonBody(request)); } catch { return reply({ error: 'Invalid request' }, 400); }
  await db().prepare('UPDATE devices SET revoked_at=?,token_hash=NULL,pairing_hash=NULL WHERE id=? AND user_id=?').bind(Date.now(), input.id, user.userId).run();
  return reply({ revoked: true });
}

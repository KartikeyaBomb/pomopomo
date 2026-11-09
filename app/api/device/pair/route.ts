import { reply, db, jsonBody } from '../../../../lib/server/api';
import { digest } from '../../../../lib/server/shared-state';
import { z } from 'zod';
export async function POST(request: Request) {
  let input; try { input = z.object({ pairingCode: z.string().regex(/^[a-f0-9]{32}$/), token: z.string().regex(/^pomo_[a-f0-9]{64}$/) }).parse(await jsonBody(request)); } catch { return reply({ error: 'Invalid pairing request' }, 400); }
  const pairHash = await digest(input.pairingCode), tokenHash = await digest(input.token), now = Date.now();
  await db().prepare('UPDATE devices SET token_hash=?,paired_at=? WHERE pairing_hash=? AND pairing_expires>? AND revoked_at IS NULL AND token_hash IS NULL').bind(tokenHash, now, pairHash, now).run();
  const row = await db().prepare('SELECT id,name FROM devices WHERE pairing_hash=? AND token_hash=? AND pairing_expires>? AND revoked_at IS NULL').bind(pairHash, tokenHash, now).first();
  return row ? reply({ paired: true, device: row }) : reply({ error: 'Pairing code expired, used, or revoked' }, 401);
}

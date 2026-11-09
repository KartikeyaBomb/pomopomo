import { reply, shared, deviceUser, jsonBody, deviceSnapshot } from '../../../../lib/server/api';
import { commandSchema } from '../../../../lib/timer-actions';
export async function POST(request: Request) {
  const device = await deviceUser(request);
  if (!device) return reply({ error: 'Invalid or revoked device' }, 401);
  let parsed; try { parsed = commandSchema.safeParse(await jsonBody(request)); } catch { return reply({ error: 'Invalid request' }, 400); }
  if (!parsed.success) return reply({ error: 'Invalid command' }, 400);
  const result = await shared().command(device.user_id, device.id, parsed.data);
  return reply(deviceSnapshot(result.body), result.status);
}

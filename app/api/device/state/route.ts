import { reply, shared, deviceUser, deviceSnapshot } from '../../../../lib/server/api';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const device = await deviceUser(request);
  if (!device) return reply({ error: 'Invalid or revoked device' }, 401);
  return reply(deviceSnapshot(await shared().settled(device.user_id)));
}

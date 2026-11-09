import { getChatGPTUser } from '../../chatgpt-auth';
import { commandSchema } from '../../../lib/timer-actions';
import { reply, shared, sameOrigin, jsonBody } from '../../../lib/server/api';
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return reply({ error: 'Sign in required' }, 401);
  if (!sameOrigin(request)) return reply({ error: 'Invalid origin' }, 403);
  let parsed; try { parsed = commandSchema.safeParse(await jsonBody(request)); } catch { return reply({ error: 'Invalid request' }, 400); }
  if (!parsed.success) return reply({ error: 'Invalid command' }, 400);
  const result = await shared().command(user.userId, 'browser', parsed.data);
  return reply({ ...result.body, serverNow: Date.now() }, result.status);
}

import { getChatGPTUser } from '../../chatgpt-auth';
import { updateSchema } from '../../../lib/state-schema';
import { reply, shared, sameOrigin, jsonBody } from '../../../lib/server/api';
export const dynamic = 'force-dynamic';
export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return reply({ error: 'Sign in to sync your tasks.' }, 401);
  return reply({ ...await shared().settled(user.userId), serverNow: Date.now() });
}
export async function PUT(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return reply({ error: 'Sign in to sync your tasks.' }, 401);
  if (!sameOrigin(request)) return reply({ error: 'Invalid origin' }, 403);
  let parsed;
  try { parsed = updateSchema.safeParse(await jsonBody(request, 500000)); } catch { return reply({ error: 'Invalid request' }, 400); }
  if (!parsed.success) return reply({ error: 'Invalid state' }, 400);
  const result = await shared().saveTasks(user.userId, parsed.data.revision, parsed.data.state);
  return reply(result.body, result.status);
}

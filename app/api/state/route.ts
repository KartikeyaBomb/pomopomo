import { and, eq, sql } from 'drizzle-orm';
import { getChatGPTUser } from '../../chatgpt-auth';
import { getDb } from '../../../db';
import { userStates } from '../../../db/schema';
import { updateSchema } from '../../../lib/state-schema';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
async function current(userId: string) {
  const [row] = await getDb().select().from(userStates).where(eq(userStates.userId, userId));
  return row ? { state: JSON.parse(row.payload), revision: row.revision } : { state: null, revision: 0 };
}
export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return reply({ error: 'Sign in to sync your tasks.' }, 401);
  return reply(await current(user.userId));
}
export async function PUT(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return reply({ error: 'Sign in to sync your tasks.' }, 401);
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) return reply({ error: 'Invalid origin' }, 403);
  const body = await request.text();
  if (body.length > 500000) return reply({ error: 'Task list is too large.' }, 413);
  let json: unknown;
  try { json = JSON.parse(body); } catch { return reply({ error: 'Invalid JSON' }, 400); }
  const parsed = updateSchema.safeParse(json);
  if (!parsed.success) return reply({ error: 'Invalid task or timer data.' }, 400);
  const { state, revision } = parsed.data;
  const db = getDb();
  const values = { userId: user.userId, payload: JSON.stringify(state), revision: 1 };
  const rows = revision === 0
    ? await db.insert(userStates).values(values).onConflictDoNothing().returning({ revision: userStates.revision })
    : await db.update(userStates).set({ payload: values.payload, revision: sql`${userStates.revision} + 1` }).where(and(eq(userStates.userId, user.userId), eq(userStates.revision, revision))).returning({ revision: userStates.revision });
  if (rows.length === 0) return reply(await current(user.userId), 409);
  return reply({ revision: rows[0].revision });
}

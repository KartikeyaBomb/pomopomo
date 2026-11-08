import { and, desc, eq, gte, lt } from 'drizzle-orm';
import { getChatGPTUser } from '../../chatgpt-auth';
import { getDb } from '../../../db';
import { activitySessions } from '../../../db/schema';
import { activityBatchSchema } from '../../../lib/activity';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return reply({ error: 'Sign in to view history.' }, 401);
  const params = new URL(request.url).searchParams;
  const start = Number(params.get('start')); const end = Number(params.get('end'));
  if (!params.has('start') || !params.has('end') || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end - start > 32 * 86400000) return reply({ error: 'Choose a valid month.' }, 400);
  const entries = await getDb().select({ id: activitySessions.id, mode: activitySessions.mode, taskId: activitySessions.taskId, taskName: activitySessions.taskName, completedAt: activitySessions.completedAt, durationSeconds: activitySessions.durationSeconds }).from(activitySessions).where(and(eq(activitySessions.userId, user.userId), gte(activitySessions.completedAt, start), lt(activitySessions.completedAt, end))).orderBy(desc(activitySessions.completedAt));
  return reply({ entries });
}
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return reply({ error: 'Sign in to save history.' }, 401);
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) return reply({ error: 'Invalid origin' }, 403);
  const body = await request.text();
  if (body.length > 60000) return reply({ error: 'Too many sessions.' }, 413);
  let json: unknown;
  try { json = JSON.parse(body); } catch { return reply({ error: 'Invalid JSON' }, 400); }
  const parsed = activityBatchSchema.safeParse(json);
  if (!parsed.success || parsed.data.entries.some(entry => entry.completedAt > Date.now() + 60000)) return reply({ error: 'Invalid session data.' }, 400);
  const db = getDb();
  const statements = parsed.data.entries.map(entry => db.insert(activitySessions).values({ ...entry, userId: user.userId }).onConflictDoNothing());
  await db.batch([statements[0]!, ...statements.slice(1)]);
  return reply({ savedIds: parsed.data.entries.map(entry => entry.id) });
}

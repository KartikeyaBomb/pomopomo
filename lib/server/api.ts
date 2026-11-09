import { env } from 'cloudflare:workers';
import { SharedState, digest } from './shared-state';
export const db = () => env.DB as D1Database;
export const shared = () => new SharedState(db());
export const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export const sameOrigin = (request: Request) => !request.headers.get('origin') || request.headers.get('origin') === new URL(request.url).origin;
export async function jsonBody(request: Request, limit = 4096) {
  const raw = await request.text();
  if (raw.length > limit) throw new Error('Request too large');
  return JSON.parse(raw);
}
export async function deviceUser(request: Request) {
  const token = request.headers.get('authorization')?.match(/^Bearer (pomo_[a-f0-9]{64})$/)?.[1];
  if (!token) return null;
  return db().prepare('SELECT id,user_id FROM devices WHERE token_hash=? AND revoked_at IS NULL').bind(await digest(token)).first<{ id: string; user_id: string }>();
}

export function deviceSnapshot(body: Record<string, unknown>) {
  const state = body.state as { tasks: Array<{ id: string; name: string; estimate: number; done: number }>; timer: unknown } | undefined;
  return { ...body, ...(state ? { state: { ...state, tasks: state.tasks.map(({ id, name, estimate, done }) => ({ id, name, estimate, done })) } } : {}), serverNow: Date.now() };
}

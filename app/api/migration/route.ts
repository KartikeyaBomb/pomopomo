import { env } from 'cloudflare:workers';
import { digest } from '../../../lib/server/shared-state';
const tables=['user_states','activity_sessions','devices','timer_commands'] as const;
type MigrationEnv={ DB: D1Database; MIGRATION_SECRET_HASH?: string; MIGRATION_EXPIRES?: string; AUTH_MODE?: string };
export async function POST(request: Request) {
  const config=env as unknown as MigrationEnv;
  const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if(config.AUTH_MODE==='cloudflare'||!token||!config.MIGRATION_SECRET_HASH||Number(config.MIGRATION_EXPIRES)<Date.now()||!config.MIGRATION_EXPIRES||await digest(token)!==config.MIGRATION_SECRET_HASH)return new Response(null,{status:404});
  let action: string;try{action=((await request.json()) as {action:string}).action;}catch{return Response.json({error:'Invalid request'},{status:400});}
  const db=config.DB;
  await db.prepare('CREATE TABLE IF NOT EXISTS hosting_migration(key TEXT PRIMARY KEY,value TEXT NOT NULL)').run();
  if(action==='unfreeze') {await db.prepare("INSERT INTO hosting_migration VALUES('frozen','0') ON CONFLICT(key) DO UPDATE SET value='0'").run();return Response.json({frozen:false});}
  const users=await db.prepare('SELECT user_id FROM user_states').all<{user_id:string}>();
  if(users.results.length!==1)return Response.json({error:'Expected one account; stop and inspect before migration.',accounts:users.results.length},{status:409});
  if(action==='freeze') {
    const statements=tables.flatMap(table=>['INSERT','UPDATE','DELETE'].map(operation=>db.prepare(`CREATE TRIGGER IF NOT EXISTS migration_${table}_${operation.toLowerCase()} BEFORE ${operation} ON ${table} WHEN (SELECT value FROM hosting_migration WHERE key='frozen')='1' BEGIN SELECT RAISE(ABORT,'Hosting migration: source is read-only'); END`)));
    statements.push(db.prepare("INSERT INTO hosting_migration VALUES('frozen','1') ON CONFLICT(key) DO UPDATE SET value='1'"));
    await db.batch(statements);
  }else if(action!=='export'&&action!=='status')return Response.json({error:'Invalid action'},{status:400});
  const frozen=(await db.prepare("SELECT value FROM hosting_migration WHERE key='frozen'").first<{value:string}>())?.value==='1';
  const snapshot:Record<string,unknown>={};
  for(const table of tables){const result=await db.prepare(`SELECT * FROM ${table} WHERE user_id=?`).bind(users.results[0].user_id).all();snapshot[table]=action==='status'?result.results.length:result.results;}
  return Response.json({version:1,frozen,exportedAt:Date.now(),ownerUserId:users.results[0].user_id,tables:snapshot},{headers:{'Cache-Control':'no-store'}});
}

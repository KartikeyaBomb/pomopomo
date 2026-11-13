import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { Miniflare } from 'miniflare';
const dir = await mkdtemp(join(tmpdir(), 'pomo-backend-'));
await writeFile(join(dir,'package.json'), '{"type":"module"}');
// Resolve the application's existing dependencies while testing its real service code.
const { symlink } = await import('node:fs/promises');
await symlink(join(process.cwd(),'node_modules'),join(dir,'node_modules'));
for (const file of ['lib/server/shared-state.ts','lib/timer-actions.ts','lib/state-schema.ts','lib/pomodoro.ts','lib/activity.ts']) {
 const output = join(dir,file.replace('.ts','.js')); await mkdir(dirname(output),{recursive:true});
 const source = await readFile(file,'utf8'); const js = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/from '(\.[^']+)'/g, "from '$1.js'"); await writeFile(output,js);
}
const { SharedState } = await import(pathToFileURL(join(dir,'lib/server/shared-state.js')));
const mf = new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}', compatibilityDate:'2026-05-22',d1Databases:['DB','MIGRATION']});
const db = await mf.getD1Database('DB');
for (const file of ['0000_silent_mercury.sql','0001_petite_sabretooth.sql','0002_dashing_norman_osborn.sql','0003_loving_landau.sql']) {
 const sql = await readFile('drizzle/'+file,'utf8'); for (const statement of sql.split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean)) await db.prepare(statement).run();
}
const service = new SharedState(db);
const task = { id:'a',name:'Existing task',estimate:5,done:2,color:'#e99573',description:'Keep me' };
async function seed(user='u') { await service.ensure(user); await db.prepare('UPDATE user_states SET payload=?,revision=1 WHERE user_id=?').bind(JSON.stringify({tasks:[task],timer:{taskId:'a',mode:'focus',remaining:1500,deadline:null}}),user).run(); }
const command=(action,revision)=>({commandId:crypto.randomUUID(),revision,action});
test('shared backend: state, retries, races, completion and history are atomic', async()=>{
 await seed();
 const start=command({type:'start'},1);
 let result=await service.command('u','device',start,100000); assert.equal(result.status,200); assert.equal(result.body.state.timer.deadline,1600000);
 result=await service.command('u','device',start,101000); assert.equal(result.status,200); assert.equal(result.body.replayed,true); assert.equal(result.body.revision,2);
 assert.equal((await service.command('u','device',{...start,action:{type:'reset'}},101000)).status,409);
 assert.equal((await service.command('u','browser',command({type:'pause'},1),102000)).status,409);
 const pause=command({type:'pause'},2); result=await service.command('u','browser',pause,110000); assert.equal(result.body.state.timer.remaining,1490);
 result=await service.command('u','device',command({type:'resume'},3),120000); assert.equal(result.body.state.timer.deadline,1610000);
 await Promise.all(Array.from({length:8},()=>service.settled('u',1611000)));
 const done=await service.read('u'); assert.equal(done.state.tasks[0].done,3); assert.equal(done.revision,5);
 const history=await db.prepare('SELECT * FROM activity_sessions WHERE user_id=?').bind('u').all(); assert.equal(history.results.length,1); assert.equal(history.results[0].completed_at,1610000); assert.equal(history.results[0].task_name,'Existing task');
 await service.settled('u',2000000); assert.equal((await service.read('u')).state.tasks[0].done,3);
 const stale=await service.command('u','browser',command({type:'reset'},4),2000000); assert.equal(stale.status,409);
 const changed=structuredClone(done.state);changed.tasks[0].done=0;changed.tasks[0].name='Renamed';
 result=await service.saveTasks('u',5,changed);assert.equal(result.status,200);assert.equal(result.body.state.tasks[0].done,3);
 result=await service.saveTasks('u',6,{tasks:[],timer:{taskId:null,mode:'focus',remaining:1500,deadline:null}});assert.equal(result.status,200);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM activity_sessions WHERE user_id=?').bind('u').first()).n,1);
 await seed('other');assert.equal((await service.read('other')).state.tasks[0].done,2);
});
test('competing commands cannot both mutate a revision; completion precedes late pause',async()=>{
 await seed('race');const outcomes=await Promise.all([service.command('race','browser',command({type:'start'},1),100),service.command('race','device',command({type:'start'},1),100)]);assert.deepEqual(outcomes.map(x=>x.status).sort(),[200,409]);
 const late=await service.command('race','device',command({type:'pause'},2),1500200);assert.equal(late.status,409);assert.equal(late.body.state.tasks[0].done,3);
});
test('break completion creates history but never task credit',async()=>{
 await seed('break');const result=await service.command('break','device',command({type:'break'},1),1000);assert.equal(result.status,200);const done=await service.settled('break',301001);assert.equal(done.state.tasks[0].done,2);assert.equal((await db.prepare('SELECT mode FROM activity_sessions WHERE user_id=?').bind('break').first()).mode,'break');
});
test('pause-aware spans survive server writes, retries and late completion without logging pauses',async()=>{
 await seed('segments');const start=1000000;
 let result=await service.command('segments','device',command({type:'start'},1),start);
 assert.equal(result.status,200);
 result=await service.command('segments','browser',command({type:'pause'},2),start+600000);
 assert.equal(result.status,200);
 assert.deepEqual(result.body.state.timer.segments,[{start,end:start+600000}]);
 const resume=command({type:'resume'},3);
 result=await service.command('segments','device',resume,start+1200000);
 assert.equal(result.status,200);
 await service.command('segments','device',resume,start+1201000);
 const end=start+1200000+900000;
 await Promise.all([service.settled('segments',end+50000),service.settled('segments',end+50000)]);
 const row=await db.prepare('SELECT segments FROM activity_sessions WHERE user_id=?').bind('segments').first();
 assert.deepEqual(JSON.parse(row.segments),[{start,end:start+600000},{start:start+1200000,end}]);
 assert.equal((await service.read('segments')).state.tasks[0].done,3);
 assert.equal((await service.read('segments')).state.timer.segments,undefined);
});
test('migration export is secret-gated and freezes all old writes until explicitly unfrozen',async()=>{
 const migrationDb=await mf.getD1Database('MIGRATION');
 for(const file of ['0000_silent_mercury.sql','0001_petite_sabretooth.sql','0002_dashing_norman_osborn.sql','0003_loving_landau.sql']) {
  const sql=await readFile('drizzle/'+file,'utf8');for(const statement of sql.split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))await migrationDb.prepare(statement).run();
 }
 const original=new SharedState(migrationDb);await original.ensure('owner');
 const {digest}=await import(pathToFileURL(join(dir,'lib/server/shared-state.js')));
 globalThis.__migrationEnv={DB:migrationDb,MIGRATION_SECRET_HASH:await digest('test-only-secret'),MIGRATION_EXPIRES:String(Date.now()+3600000)};
 const routePath=join(dir,'app/api/migration/route.js');await mkdir(dirname(routePath),{recursive:true});
 let source=ts.transpileModule(await readFile('app/api/migration/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 source=source.replace(/import \{ env \} from ['"]cloudflare:workers['"];?/, 'const env=globalThis.__migrationEnv;').replace(/from '(\.[^']+)'/g, "from '$1.js'");await writeFile(routePath,source);
 const {POST}=await import(pathToFileURL(routePath));
 const call=(action,token='test-only-secret')=>POST(new Request('https://source.test/api/migration',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action})}));
 assert.equal((await call('export','wrong')).status,404);
 const frozen=await (await call('freeze')).json();assert.equal(frozen.frozen,true);assert.equal(frozen.ownerUserId,'owner');assert.equal(frozen.tables.user_states.length,1);
 await assert.rejects(()=>original.commit('owner',0,{tasks:[],timer:{taskId:null,mode:'focus',remaining:1500,deadline:null}}),/read-only/);
 assert.equal((await original.read('owner')).revision,0);
 await call('unfreeze');assert.equal(await original.commit('owner',0,{tasks:[],timer:{taskId:null,mode:'focus',remaining:1500,deadline:null}}),true);
 globalThis.__migrationEnv.AUTH_MODE='cloudflare';assert.equal((await call('export')).status,404);delete globalThis.__migrationEnv;
});
test.after(async()=>{await mf.dispose();await rm(dir,{recursive:true,force:true});});

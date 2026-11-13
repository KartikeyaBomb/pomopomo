import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const code=ts.transpileModule(await readFile('gateway/worker.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {default:gateway}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('gateway only forwards device routes, strips identity, and keeps service credentials server-side',async()=>{
 const saved=globalThis.fetch;let outgoing;
 globalThis.fetch=async(url,options)=>{outgoing={url,options};return Response.json({state:{tasks:[]}});};
 try {
  const env={POMOPOMO:{fetch:(...args)=>globalThis.fetch(...args)}};const token='Bearer pomo_'+'a'.repeat(64);
  assert.equal((await gateway.fetch(new Request('https://gateway.test/api/state'),env)).status,404);
  assert.equal((await gateway.fetch(new Request('https://gateway.test/api/device/state'),env)).status,401);
  assert.equal((await gateway.fetch(new Request('https://gateway.test/api/device/state?url=https://evil.test',{headers:{Authorization:token}}),env)).status,404);
  const r=await gateway.fetch(new Request('https://gateway.test/api/device/state',{headers:{Authorization:token,Cookie:'session=bad','oai-authenticated-user-id':'spoof','OAI-Sites-Authorization':'spoof'}}),env);
  assert.equal(r.status,200);assert.equal(outgoing.url,'https://pomopomo.pomopomo-karti.workers.dev/api/device/state');assert.equal(outgoing.options.headers.get('OAI-Sites-Authorization'),null);assert.equal(outgoing.options.headers.get('Authorization'),token);assert.equal(outgoing.options.headers.get('Cookie'),null);assert.equal(outgoing.options.headers.get('oai-authenticated-user-id'),null);assert.equal(r.headers.get('OAI-Sites-Authorization'),null);
  assert.equal((await gateway.fetch(new Request('https://gateway.test/api/device/pair',{method:'POST',body:'a'.repeat(4097)}),env)).status,413);
  globalThis.fetch=async()=>new Response('<html>Sign in</html>',{status:401,headers:{'content-type':'text/html'}});
  assert.equal((await gateway.fetch(new Request('https://gateway.test/api/device/state',{headers:{Authorization:token}}),env)).status,502);
 }finally{globalThis.fetch=saved;}
});

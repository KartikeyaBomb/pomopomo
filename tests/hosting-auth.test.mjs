import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {generateKeyPair,exportJWK,createLocalJWKSet,SignJWT} from 'jose';
const dir=await mkdtemp(join(tmpdir(),'pomo-auth-'));
await symlink(join(process.cwd(),'node_modules'),join(dir,'node_modules'));
await writeFile(join(dir,'auth.mjs'),ts.transpileModule(await readFile('lib/server/hosting-auth.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
const {accessIdentity}=await import(pathToFileURL(join(dir,'auth.mjs')));
const {privateKey,publicKey}=await generateKeyPair('RS256');const key=await exportJWK(publicKey);key.kid='test';const keys=createLocalJWKSet({keys:[key]});
const config={AUTH_MODE:'cloudflare',ACCESS_TEAM_DOMAIN:'test.cloudflareaccess.com',ACCESS_AUD:'pomo',OWNER_EMAIL:'owner@example.test',OWNER_USER_ID:'existing-sites-user'};
async function token(email='owner@example.test',aud='pomo',expiry='1h'){return new SignJWT({email}).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuer('https://test.cloudflareaccess.com').setAudience(aud).setIssuedAt().setExpirationTime(expiry).sign(privateKey);}
test('Cloudflare auth maps only a verified owner to the original account',async()=>{
 assert.equal((await accessIdentity(await token(),config,keys)).userId,'existing-sites-user');
 assert.equal(await accessIdentity(await token('attacker@example.test'),config,keys),null);
 assert.equal(await accessIdentity(await token('owner@example.test','other-app'),config,keys),null);
 assert.equal(await accessIdentity(await token('owner@example.test','pomo','-1h'),config,keys),null);
 assert.equal(await accessIdentity(null,config,keys),null);
 assert.equal(await accessIdentity('spoofed-user-header',config,keys),null);
 assert.equal(await accessIdentity(await token(),{...config,OWNER_USER_ID:undefined},keys),null);
});
test.after(()=>rm(dir,{recursive:true,force:true}));

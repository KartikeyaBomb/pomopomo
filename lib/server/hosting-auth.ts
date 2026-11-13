import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
export type HostingAuth = { AUTH_MODE?: string; ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string; OWNER_EMAIL?: string; OWNER_USER_ID?: string };
let keyset: { domain: string; keys: JWTVerifyGetKey } | undefined;
export async function accessIdentity(token: string | null, config: HostingAuth, suppliedKeys?: JWTVerifyGetKey) {
  const domain=config.ACCESS_TEAM_DOMAIN;
  if (!token || !domain || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain) || !config.ACCESS_AUD || !config.OWNER_EMAIL || !config.OWNER_USER_ID) return null;
  try {
    if(keyset?.domain!==domain)keyset={domain,keys:createRemoteJWKSet(new URL(`https://${domain}/cdn-cgi/access/certs`))};
    const { payload }=await jwtVerify(token,suppliedKeys ?? keyset.keys,{issuer:`https://${domain}`,audience:config.ACCESS_AUD,algorithms:['RS256']});
    if(typeof payload.email!=='string'||payload.email.toLowerCase()!==config.OWNER_EMAIL.toLowerCase())return null;
    return {userId:config.OWNER_USER_ID,email:payload.email,displayName:payload.email,fullName:null};
  }catch{return null;}
}

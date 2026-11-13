import handler from 'vinext/server/fetch-handler';
export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    const url=new URL(request.url);
    // Never accept Sites' browser identity headers on independently hosted requests.
    const clean=new Headers(request.headers);
    for(const name of [...clean.keys()])if(name.startsWith('oai-authenticated-user-'))clean.delete(name);
    if(url.pathname==='/signin-with-chatgpt')return Response.redirect(new URL('/',url).toString(),302);
    if(url.pathname.startsWith('/api/')) {
      const ready=await env.DB?.prepare("SELECT value FROM deployment_state WHERE key='ready'").first<{value:string}>().catch(()=>null);
      if(ready?.value!=='1')return Response.json({error:'Migration is being prepared. Please try again shortly.'},{status:503,headers:{'Retry-After':'60'}});
    }
    return handler.fetch(new Request(request,{headers:clean}),env,ctx);
  },
};

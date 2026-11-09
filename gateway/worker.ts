interface Env { SITES_SERVICE_TOKEN: string }
const ORIGIN = 'https://pomopomo-focus-kr7.cloudywand21.chatgpt.site';
const allowed = new Map([['GET /api/device/state', 0], ['POST /api/device/pair', 4096], ['POST /api/device/command', 4096]]);
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url), limit = allowed.get(`${request.method} ${url.pathname}`);
    if (limit === undefined || url.search) return Response.json({ error: 'Not found' }, { status: 404 });
    if (!env.SITES_SERVICE_TOKEN) return Response.json({ error: 'Gateway not configured' }, { status: 503 });
    const auth = request.headers.get('authorization');
    if (url.pathname !== '/api/device/pair' && !/^Bearer pomo_[a-f0-9]{64}$/.test(auth ?? '')) return Response.json({ error: 'Device token required' }, { status: 401 });
    let body: string | undefined;
    if (request.method === 'POST') {
      if (Number(request.headers.get('content-length')) > limit) return new Response(null, { status: 413 });
      const reader = request.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      if (reader) { for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > limit) { await reader.cancel(); return new Response(null, { status: 413 }); } chunks.push(chunk.value); } }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } body = new TextDecoder().decode(bytes);
    }
    const headers = new Headers({ 'OAI-Sites-Authorization': `Bearer ${env.SITES_SERVICE_TOKEN}`, 'Content-Type': 'application/json' });
    if (auth) headers.set('Authorization', auth);
    try {
      // Fixed origin + exact path allowlist. Never forward client identity, cookies or redirects.
      const response = await fetch(ORIGIN + url.pathname, { method: request.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(15000) });
      if (!(response.headers.get('content-type') ?? '').includes('application/json')) return Response.json({ error: 'Sites gateway access unavailable' }, { status: 502 });
      return new Response(response.body, { status: response.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    } catch { return Response.json({ error: 'Upstream unavailable' }, { status: 502 }); }
  },
};

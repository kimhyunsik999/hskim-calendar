// Cloudflare Worker: CORS proxy so the PWA can read public iCloud calendar (ICS) links.
// Deliberately NOT an open proxy: only iCloud/Google public calendar hosts, only from the app's origins.

const ALLOWED_ORIGINS = ['https://kimhyunsik999.github.io', 'http://localhost:5173', 'http://localhost:4173'];
const ALLOWED_HOSTS = [/^p\d+-caldav\.icloud\.com$/, /^calendar\.google\.com$/];
const MAX_BYTES = 5 * 1024 * 1024;

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') ?? '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      Vary: 'Origin',
    };
    const reply = (body, status, extra = {}) => new Response(body, { status, headers: { ...cors, ...extra } });

    if (request.method === 'OPTIONS') return reply(null, 204);
    if (request.method !== 'GET') return reply('method not allowed', 405);
    if (!ALLOWED_ORIGINS.includes(origin)) return reply('forbidden', 403);

    let target;
    try {
      target = new URL((new URL(request.url).searchParams.get('url') ?? '').replace(/^webcal:\/\//i, 'https://'));
    } catch {
      return reply('bad url', 400);
    }
    if (target.protocol !== 'https:' || !ALLOWED_HOSTS.some((h) => h.test(target.hostname))) return reply('host not allowed', 400);

    const upstream = await fetch(target.toString(), {
      headers: { Accept: 'text/calendar, */*' },
      redirect: 'follow',
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    // iCloud may redirect between pNN-caldav hosts; make sure we still ended up somewhere allowed.
    if (!ALLOWED_HOSTS.some((h) => h.test(new URL(upstream.url).hostname))) return reply('redirect not allowed', 502);
    const text = await upstream.text();
    if (text.length > MAX_BYTES) return reply('too large', 502);
    return reply(text, upstream.status, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'max-age=300' });
  },
};

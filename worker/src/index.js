// Cloudflare Worker for the 4조 근무표 PWA.
//  GET  /?url=<ics>       CORS proxy for public iCloud/Google calendar (ICS) links.
//  POST /auth/exchange    Google OAuth code → access token + encrypted refresh token ("rt").
//  POST /auth/refresh     encrypted rt → fresh access token.
//  POST /auth/revoke      revoke the refresh token.
//  POST /push/*           spouse push notifications (see push.js).
// Deliberately NOT an open proxy: only the app's origins, only calendar hosts.
// Refresh tokens are never stored here: they're AES-GCM encrypted with TOKEN_KEY and kept by the client.
//
// Secrets (wrangler secret put): GOOGLE_CLIENT_SECRET, TOKEN_KEY (base64, 32 bytes). Var: GOOGLE_CLIENT_ID.

import { handlePush } from './push.js';

const ALLOWED_ORIGINS = ['https://kimhyunsik999.github.io', 'http://localhost:5173', 'http://localhost:4173'];
const ALLOWED_HOSTS = [/^p\d+-caldav\.icloud\.com$/, /^calendar\.google\.com$/];
const MAX_BYTES = 5 * 1024 * 1024;
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    };
    const reply = (body, status, extra = {}) => new Response(body, { status, headers: { ...cors, ...extra } });
    const json = (obj, status = 200) => reply(JSON.stringify(obj), status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });

    if (request.method === 'OPTIONS') return reply(null, 204);
    if (!ALLOWED_ORIGINS.includes(origin)) return reply('forbidden', 403);

    const path = new URL(request.url).pathname;
    if (path.startsWith('/push/')) {
      if (request.method !== 'POST') return reply('method not allowed', 405);
      try {
        return json(await handlePush(path, await request.json(), env));
      } catch (e) {
        return json({ error: e.code ?? 'error', message: String(e.message ?? e) }, e.status ?? 500);
      }
    }
    if (path.startsWith('/auth/')) {
      if (request.method !== 'POST') return reply('method not allowed', 405);
      if (!env.GOOGLE_CLIENT_SECRET || !env.TOKEN_KEY || !env.GOOGLE_CLIENT_ID) return json({ error: 'not_configured' }, 501);
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'bad_request' }, 400);
      }
      try {
        if (path === '/auth/exchange') return json(await exchange(env, body.code));
        if (path === '/auth/refresh') return json(await refresh(env, body.rt));
        if (path === '/auth/revoke') return json(await revoke(env, body.rt));
      } catch (e) {
        const status = e.status ?? 500;
        return json({ error: e.code ?? 'error', message: String(e.message ?? e) }, status);
      }
      return json({ error: 'not_found' }, 404);
    }

    if (request.method !== 'GET') return reply('method not allowed', 405);
    return proxyIcs(request, reply);
  },
};

// ---------- ICS proxy ----------

async function proxyIcs(request, reply) {
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
}

// ---------- Google OAuth ----------

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function google(params) {
  const r = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const j = await r.json();
  if (!r.ok) {
    // invalid_grant = refresh token revoked/expired → client must sign in again.
    throw new HttpError(j.error === 'invalid_grant' ? 401 : 400, j.error ?? 'google_error', j.error_description ?? 'Google token error');
  }
  return j;
}

async function exchange(env, code) {
  if (typeof code !== 'string' || !code) throw new HttpError(400, 'bad_request', 'missing code');
  const t = await google({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: 'postmessage', // GIS popup code flow
    grant_type: 'authorization_code',
  });
  if (!t.refresh_token) throw new HttpError(400, 'no_refresh_token', 'Google did not return a refresh token');
  return { access_token: t.access_token, expires_in: t.expires_in, rt: await seal(env, t.refresh_token) };
}

async function refresh(env, rt) {
  const token = await open(env, rt);
  const t = await google({
    refresh_token: token,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  return { access_token: t.access_token, expires_in: t.expires_in };
}

async function revoke(env, rt) {
  const token = await open(env, rt).catch(() => null);
  if (token) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' });
  return { ok: true };
}

// ---------- AES-GCM sealing of refresh tokens ----------

const b64 = {
  enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
};

const key = (env) => crypto.subtle.importKey('raw', b64.dec(env.TOKEN_KEY.replace(/=+$/, '')), 'AES-GCM', false, ['encrypt', 'decrypt']);

async function seal(env, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(env), new TextEncoder().encode(plain));
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv);
  out.set(new Uint8Array(ct), 12);
  return 'v1.' + b64.enc(out);
}

async function open(env, sealed) {
  if (typeof sealed !== 'string' || !sealed.startsWith('v1.')) throw new HttpError(401, 'invalid_grant', 'bad token');
  try {
    const raw = b64.dec(sealed.slice(3));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, await key(env), raw.slice(12));
    return new TextDecoder().decode(pt);
  } catch {
    throw new HttpError(401, 'invalid_grant', 'bad token');
  }
}

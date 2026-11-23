// Web Push for "배우자 변경 알림".
//  POST /push/subscribe   { token, calId, sub, name }   register this device for the shared calendar
//  POST /push/unsubscribe { token, calId, endpoint }
//  POST /push/notify      { token, calId, body, self? } push to the *other* members' devices
// The caller proves membership with their Google access token (must be able to read calId).
// Subscriptions live in KV (binding PUSH): key `sub:<calHash>:<endpointHash>` → { email, sub }.
// Payload encryption: RFC 8291 (aes128gcm). Auth: VAPID (RFC 8292) ES256 JWT.
//
// Env: PUSH (KV), VAPID_PUBLIC (var, base64url raw P-256), VAPID_PRIVATE_JWK (secret, JSON JWK).

const enc = new TextEncoder();
const b64u = {
  enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
};
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const sha = async (s) => b64u.enc(await crypto.subtle.digest('SHA-256', enc.encode(s))).slice(0, 22);

export class PushError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ---------- membership check via Google ----------

async function whoCanSee(token, calId) {
  const h = { Authorization: `Bearer ${token}` };
  const [cal, primary] = await Promise.all([
    fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}`, { headers: h }),
    fetch('https://www.googleapis.com/calendar/v3/calendars/primary', { headers: h }),
  ]);
  if (cal.status === 401 || primary.status === 401) throw new PushError(401, 'unauthorized', 'Google token invalid');
  if (!cal.ok) throw new PushError(403, 'forbidden', 'no access to calendar');
  const me = await primary.json();
  return String(me.id ?? '').toLowerCase(); // primary calendar id = account email
}

// ---------- RFC 8291 payload encryption ----------

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** Encrypt `payload` for a PushSubscription ({ keys: { p256dh, auth } }). Returns the aes128gcm body. */
export async function encryptPayload(sub, payload, { salt = crypto.getRandomValues(new Uint8Array(16)), asKeys } = {}) {
  const uaPublic = b64u.dec(sub.keys.p256dh);
  const authSecret = b64u.dec(sub.keys.auth);
  const as = asKeys ?? (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));

  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const plain = concat(enc.encode(payload), new Uint8Array([2])); // 0x02 = last record delimiter
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain));

  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ct);
}

// ---------- VAPID ----------

async function vapidAuth(env, endpoint) {
  const aud = new URL(endpoint).origin;
  const header = b64u.enc(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u.enc(
    enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://kimhyunsik999.github.io/hskim-calendar/' })),
  );
  const key = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u.enc(sig)}, k=${env.VAPID_PUBLIC}`;
}

async function send(env, sub, message) {
  const body = await encryptPayload(sub, JSON.stringify(message));
  return fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuth(env, sub.endpoint),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    },
    body,
  });
}

// ---------- routes ----------

const validSub = (s) => s && typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint) && s.keys?.p256dh && s.keys?.auth;

export async function handlePush(path, body, env) {
  if (!env.PUSH || !env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC) throw new PushError(501, 'not_configured', 'push not configured');
  const { token, calId } = body ?? {};
  if (typeof token !== 'string' || typeof calId !== 'string') throw new PushError(400, 'bad_request', 'token and calId required');
  const email = await whoCanSee(token, calId);
  const prefix = `sub:${await sha(calId)}:`;

  if (path === '/push/subscribe') {
    if (!validSub(body.sub)) throw new PushError(400, 'bad_request', 'invalid subscription');
    const name = String(body.name ?? '').slice(0, 20);
    await env.PUSH.put(prefix + (await sha(body.sub.endpoint)), JSON.stringify({ email, name, sub: body.sub }), {
      expirationTtl: 60 * 60 * 24 * 180, // re-registered on app use; stale devices age out
    });
    return { ok: true };
  }

  if (path === '/push/unsubscribe') {
    if (typeof body.endpoint === 'string') await env.PUSH.delete(prefix + (await sha(body.endpoint)));
    return { ok: true };
  }

  if (path === '/push/notify') {
    const text = String(body.body ?? '').slice(0, 200);
    if (!text) throw new PushError(400, 'bad_request', 'body required');
    const { keys } = await env.PUSH.list({ prefix });
    let sent = 0;
    let removed = 0;
    await Promise.all(
      keys.map(async ({ name: k }) => {
        const rec = await env.PUSH.get(k, 'json');
        if (!rec || (!body.self && rec.email === email)) return;
        const r = await send(env, rec.sub, { title: '4조 근무표', body: text, tag: `hc-${Date.now()}`, url: './' });
        if (r.status === 404 || r.status === 410) {
          await env.PUSH.delete(k); // subscription gone
          removed++;
        } else if (r.ok) sent++;
      }),
    );
    return { ok: true, sent, removed };
  }

  throw new PushError(404, 'not_found', 'unknown route');
}

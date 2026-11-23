import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error — plain JS Worker module
import { encryptPayload, handlePush } from '../worker/src/push.js';

const b64u = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString('base64url');
const te = new TextEncoder();

type Bytes = Uint8Array<ArrayBuffer>;
async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, n: number) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, n * 8));
}

/** A browser-side push subscription with its private key, so the test can decrypt like the UA would. */
async function fakeBrowser() {
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
  const sub = { endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: b64u(pub), auth: b64u(auth) } };
  const decrypt = async (body: Bytes) => {
    const salt = body.slice(0, 16);
    const idlen = body[20];
    const asPub = body.slice(21, 21 + idlen);
    const ct = body.slice(21 + idlen);
    const asKey = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
    const info = new Uint8Array([...te.encode('WebPush: info\0'), ...pub, ...asPub]);
    const ikm = await hkdf(auth, ecdh, info, 32);
    const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
    const k = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, k, ct));
    expect(plain.at(-1)).toBe(2); // last-record delimiter
    return new TextDecoder().decode(plain.slice(0, -1));
  };
  return { sub, decrypt };
}

describe('web push (RFC 8291)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('encrypts a payload the browser can decrypt', async () => {
    const b = await fakeBrowser();
    const body = await encryptPayload(b.sub, '{"body":"혜연님이 12/3 근무를 연차로 변경"}');
    expect(Array.from(body.slice(16, 20))).toEqual([0, 0, 16, 0]); // rs = 4096
    expect(body[20]).toBe(65); // uncompressed P-256 key id
    expect(await b.decrypt(body)).toBe('{"body":"혜연님이 12/3 근무를 연차로 변경"}');
  });

  it('notifies only the other member, signs VAPID, and prunes dead subscriptions', async () => {
    const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const kv = new Map<string, string>();
    const env = {
      VAPID_PUBLIC: b64u(await crypto.subtle.exportKey('raw', vapid.publicKey)),
      VAPID_PRIVATE_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', vapid.privateKey)),
      PUSH: {
        put: async (k: string, v: string) => void kv.set(k, v),
        get: async (k: string) => JSON.parse(kv.get(k) ?? 'null'),
        delete: async (k: string) => void kv.delete(k),
        list: async ({ prefix }: { prefix: string }) => ({ keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }),
      },
    };
    const husband = await fakeBrowser();
    const wife = await fakeBrowser();
    wife.sub.endpoint = 'https://fcm.googleapis.com/wife';
    const gone = await fakeBrowser();
    gone.sub.endpoint = 'https://web.push.apple.com/gone';

    const delivered: { to: string; auth: string; body: Bytes }[] = [];
    let who = 'h@gmail.com';
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.includes('/calendars/primary')) return Response.json({ id: who });
      if (url.includes('googleapis.com/calendar')) return url.includes('NOPE') ? new Response('', { status: 404 }) : Response.json({ id: 'cal' });
      delivered.push({ to: url, auth: String((init!.headers as Record<string, string>).Authorization), body: init!.body as Bytes });
      return new Response(null, { status: url.endsWith('/gone') ? 410 : 201 });
    });

    await handlePush('/push/subscribe', { token: 't', calId: 'cal', sub: husband.sub, name: '현식' }, env);
    who = 'w@gmail.com';
    await handlePush('/push/subscribe', { token: 't', calId: 'cal', sub: wife.sub, name: '혜연' }, env);
    await handlePush('/push/subscribe', { token: 't', calId: 'cal', sub: gone.sub }, env);
    expect(kv.size).toBe(3);

    // Wife changes something → only husband's device gets it (both of her own devices are skipped).
    const r = await handlePush('/push/notify', { token: 't', calId: 'cal', body: '혜연님이 12/3 근무를 연차로 변경했어요' }, env);
    expect(r).toEqual({ ok: true, sent: 1, removed: 0 });
    expect(delivered.map((d) => d.to)).toEqual([husband.sub.endpoint]);
    expect(delivered[0].auth).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
    expect(JSON.parse(await husband.decrypt(delivered[0].body)).body).toBe('혜연님이 12/3 근무를 연차로 변경했어요');

    // Husband notifies → wife's live device gets it, her dead device is pruned.
    who = 'h@gmail.com';
    delivered.length = 0;
    const r2 = await handlePush('/push/notify', { token: 't', calId: 'cal', body: 'x' }, env);
    expect(r2).toEqual({ ok: true, sent: 1, removed: 1 });
    expect(kv.size).toBe(2);

    // Someone without access to the calendar is rejected.
    await expect(handlePush('/push/notify', { token: 't', calId: 'NOPE', body: 'x' }, env)).rejects.toMatchObject({ status: 403 });
  });
});

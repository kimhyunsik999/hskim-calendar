import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error — plain JS Worker module
import worker from '../worker/src/index.js';

const ORIGIN = 'https://kimhyunsik999.github.io';
const env = {
  GOOGLE_CLIENT_ID: 'cid',
  GOOGLE_CLIENT_SECRET: 'secret',
  TOKEN_KEY: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),
};
const post = (path: string, body: unknown, origin = ORIGIN) =>
  worker.fetch(
    new Request(`https://w.example${path}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    env,
  ) as Promise<Response>;

describe('worker auth', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('exchanges a code, seals the refresh token, and refreshes with it', async () => {
    const seen: URLSearchParams[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      expect(url).toBe('https://oauth2.googleapis.com/token');
      const p = new URLSearchParams(init.body as string);
      seen.push(p);
      if (p.get('grant_type') === 'authorization_code') {
        return Response.json({ access_token: 'AT1', expires_in: 3599, refresh_token: 'RT-SECRET' });
      }
      return Response.json({ access_token: 'AT2', expires_in: 3599 });
    });

    const ex = await post('/auth/exchange', { code: 'CODE' });
    expect(ex.status).toBe(200);
    expect(ex.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    const x = await ex.json();
    expect(x.access_token).toBe('AT1');
    expect(x.rt).toMatch(/^v1\./);
    expect(x.rt).not.toContain('RT-SECRET'); // encrypted, not plain
    expect(seen[0].get('redirect_uri')).toBe('postmessage');
    expect(seen[0].get('client_secret')).toBe('secret');

    const rf = await post('/auth/refresh', { rt: x.rt });
    expect(rf.status).toBe(200);
    expect((await rf.json()).access_token).toBe('AT2');
    expect(seen[1].get('refresh_token')).toBe('RT-SECRET'); // decrypted server-side
  });

  it('rejects tampered tokens, foreign origins, and Google invalid_grant', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, { status: 400 }));
    expect((await post('/auth/refresh', { rt: 'v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAA' })).status).toBe(401);
    expect((await post('/auth/refresh', { rt: 'garbage' })).status).toBe(401);
    expect((await post('/auth/exchange', { code: 'X' }, 'https://evil.example')).status).toBe(403);
    expect((await post('/auth/exchange', { code: 'X' })).status).toBe(401); // invalid_grant from Google
  });

  it('reports not_configured without secrets', async () => {
    const r = (await worker.fetch(
      new Request('https://w.example/auth/refresh', { method: 'POST', headers: { Origin: ORIGIN }, body: '{}' }),
      {},
    )) as Response;
    expect(r.status).toBe(501);
  });
});

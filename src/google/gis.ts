// Google sign-in.
//  - Persistent mode (VITE_PERSISTENT_LOGIN=1): GIS *code* flow; our Worker exchanges the code and hands back
//    an encrypted refresh token ("rt") so the app can renew access silently — no hourly re-login.
//  - Fallback: GIS *token* flow, browser-only, access token valid ~1h.

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    google?: any;
  }
}

export const CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
const WORKER: string = import.meta.env.VITE_ICS_PROXY ?? '';
export const PERSISTENT = import.meta.env.VITE_PERSISTENT_LOGIN === '1' && !!WORKER;
const SCOPE = 'https://www.googleapis.com/auth/calendar';
const KEY = 'hc.gtoken';

export type Token = { access_token: string; expires_at: number; rt?: string };

let loader: Promise<void> | null = null;

/** Load the GIS script early, so sign-in can open its popup synchronously inside the tap handler (iOS blocks async popups). */
export function initGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  loader ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loader = null;
      reject(new Error('Google 로그인 스크립트를 불러오지 못했습니다.'));
    };
    document.head.appendChild(s);
  });
  return loader;
}

function read(): Token | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') as Token | null;
  } catch {
    return null;
  }
}
function write(t: Token | null) {
  try {
    if (t) localStorage.setItem(KEY, JSON.stringify(t));
    else localStorage.removeItem(KEY);
  } catch {
    /* token just won't survive reload */
  }
}

/** A token whose access part is still valid for at least a minute. */
export function storedToken(): Token | null {
  const t = read();
  return t && t.expires_at > Date.now() + 60_000 ? t : null;
}

/** True when we can renew without user interaction. */
export const canRefresh = () => !!read()?.rt;

export function clearToken() {
  write(null);
}

async function worker<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${WORKER}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(j.message || j.error || `로그인 서버 오류 (${r.status})`) as Error & { status?: number };
    err.status = r.status;
    throw err;
  }
  return j as T;
}

let inflight: Promise<Token> | null = null;

/** Silently renew the access token with the stored refresh token. Rejects (and clears) if it was revoked/expired. */
export function refreshToken(): Promise<Token> {
  const cur = read();
  if (!cur?.rt) return Promise.reject(new Error('no refresh token'));
  inflight ??= worker<{ access_token: string; expires_in: number }>('/auth/refresh', { rt: cur.rt })
    .then((r) => {
      const t: Token = { access_token: r.access_token, expires_at: Date.now() + r.expires_in * 1000, rt: cur.rt };
      write(t);
      return t;
    })
    .catch((e: Error & { status?: number }) => {
      if (e.status === 401) clearToken(); // revoked / expired → must sign in again
      throw e;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Must be called directly from a user gesture after initGis() resolved. */
export function requestToken(firstTime: boolean): Promise<Token> {
  return new Promise((resolve, reject) => {
    const oauth2 = window.google?.accounts?.oauth2;
    if (!CLIENT_ID) return reject(new Error('Google Client ID가 설정되지 않았습니다 (VITE_GOOGLE_CLIENT_ID).'));
    if (!oauth2) return reject(new Error('Google 로그인 준비 중입니다. 잠시 후 다시 눌러주세요.'));
    const onError = (e: any) => reject(new Error(e?.message || e?.type || '로그인이 취소되었습니다.'));

    if (PERSISTENT) {
      oauth2
        .initCodeClient({
          client_id: CLIENT_ID,
          scope: SCOPE,
          ux_mode: 'popup',
          // Always ask, so Google returns a refresh token even if the user consented before.
          prompt: 'consent',
          callback: (r: any) => {
            if (r.error) return reject(new Error(r.error_description || r.error));
            worker<{ access_token: string; expires_in: number; rt: string }>('/auth/exchange', { code: r.code }).then((x) => {
              const t: Token = { access_token: x.access_token, expires_at: Date.now() + x.expires_in * 1000, rt: x.rt };
              write(t);
              resolve(t);
            }, reject);
          },
          error_callback: onError,
        })
        .requestCode();
      return;
    }

    oauth2
      .initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        prompt: firstTime ? 'consent' : '',
        callback: (r: any) => {
          if (r.error) return reject(new Error(r.error_description || r.error));
          const t: Token = { access_token: r.access_token, expires_at: Date.now() + Number(r.expires_in) * 1000 };
          write(t);
          resolve(t);
        },
        error_callback: onError,
      })
      .requestAccessToken();
  });
}

export function revoke() {
  const t = read();
  if (t?.rt) worker('/auth/revoke', { rt: t.rt }).catch(() => undefined);
  else if (t) window.google?.accounts?.oauth2?.revoke(t.access_token, () => undefined);
  clearToken();
}

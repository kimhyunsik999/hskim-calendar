// Google Identity Services (token model) — browser-only OAuth, no backend.

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    google?: any;
  }
}

export const CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
const SCOPE = 'https://www.googleapis.com/auth/calendar';
const KEY = 'hc.gtoken';

export type Token = { access_token: string; expires_at: number };

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

export function storedToken(): Token | null {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Token | null;
    return t && t.expires_at > Date.now() + 60_000 ? t : null;
  } catch {
    return null;
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Must be called directly from a user gesture after initGis() resolved. */
export function requestToken(firstTime: boolean): Promise<Token> {
  return new Promise((resolve, reject) => {
    const oauth2 = window.google?.accounts?.oauth2;
    if (!CLIENT_ID) return reject(new Error('Google Client ID가 설정되지 않았습니다 (VITE_GOOGLE_CLIENT_ID).'));
    if (!oauth2) return reject(new Error('Google 로그인 준비 중입니다. 잠시 후 다시 눌러주세요.'));
    const client = oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      prompt: firstTime ? 'consent' : '',
      callback: (r: any) => {
        if (r.error) return reject(new Error(r.error_description || r.error));
        const t: Token = { access_token: r.access_token, expires_at: Date.now() + Number(r.expires_in) * 1000 };
        try {
          localStorage.setItem(KEY, JSON.stringify(t));
        } catch {
          /* token just won't survive reload */
        }
        resolve(t);
      },
      error_callback: (e: any) => reject(new Error(e?.message || e?.type || '로그인이 취소되었습니다.')),
    });
    client.requestAccessToken();
  });
}

export function revoke(t: Token | null) {
  if (t) window.google?.accounts?.oauth2?.revoke(t.access_token, () => undefined);
  clearToken();
}

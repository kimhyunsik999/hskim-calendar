// Client side of "배우자 변경 알림" (Web Push via our Worker).
// iOS: works only for the home-screen app (iOS 16.4+), and permission must be requested from a tap.

const WORKER: string = import.meta.env.VITE_ICS_PROXY ?? '';
const VAPID: string = import.meta.env.VITE_VAPID_PUBLIC ?? '';

export const pushConfigured = !!(WORKER && VAPID);
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

async function call(path: string, body: unknown) {
  const r = await fetch(`${WORKER}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || j.error || `알림 서버 오류 (${r.status})`);
  return j;
}

const keyBytes = (b64u: string) => Uint8Array.from(atob(b64u.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

const REG_KEY = 'hc.pushReg';

/** Ask permission (call from a tap), subscribe, and register with the Worker. */
export async function enablePush(token: string, calId: string, name: string) {
  if (!pushSupported()) throw new Error('이 브라우저는 알림을 지원하지 않습니다. 아이폰은 홈 화면에 추가한 앱에서만 됩니다.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('알림 권한이 허용되지 않았습니다. 아이폰 설정 › 알림 › 4조근무에서 허용해주세요.');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID) }));
  await register(token, calId, name, sub);
}

async function register(token: string, calId: string, name: string, sub: PushSubscription) {
  await call('/push/subscribe', { token, calId, name, sub: sub.toJSON() });
  try {
    localStorage.setItem(REG_KEY, `${calId}|${sub.endpoint}|${name}`);
  } catch {
    /* ignore */
  }
}

/** Keep the Worker's copy fresh (KV entries expire after 180 days; endpoints can rotate). Cheap no-op if unchanged. */
export async function refreshRegistration(token: string, calId: string, name: string) {
  if (!pushConfigured || !pushSupported() || Notification.permission !== 'granted') return;
  const sub = await currentSubscription();
  if (!sub) return;
  let last = '';
  try {
    last = localStorage.getItem(REG_KEY) ?? '';
  } catch {
    /* ignore */
  }
  if (last === `${calId}|${sub.endpoint}|${name}`) return;
  await register(token, calId, name, sub);
}

export async function disablePush(token: string, calId: string) {
  const sub = await currentSubscription();
  if (sub) {
    await call('/push/unsubscribe', { token, calId, endpoint: sub.endpoint }).catch(() => undefined);
    await sub.unsubscribe();
  }
  try {
    localStorage.removeItem(REG_KEY);
  } catch {
    /* ignore */
  }
}

/** Tell the other member(s). Fire-and-forget; `self` also notifies this account (for testing). */
export function notifySpouse(token: string, calId: string, body: string, self = false) {
  if (!pushConfigured) return Promise.resolve({ sent: 0 });
  return call('/push/notify', { token, calId, body, self }) as Promise<{ sent: number }>;
}

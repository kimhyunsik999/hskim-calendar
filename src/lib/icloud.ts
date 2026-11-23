// Client for writing to the couple's iCloud calendars through our Worker (CalDAV on the server side).

const WORKER: string = import.meta.env.VITE_ICS_PROXY ?? '';

export type ICloudCal = { id: string; name: string; color: string };
export type NewEvent = { title: string; date: string; time?: string; minutes?: number };

async function call<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${WORKER}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j.message || j.error || `iCloud 서버 오류 (${r.status})`) as Error & { code?: string };
    e.code = j.error;
    throw e;
  }
  return j as T;
}

const KEY = 'hc.icloudCals';

export function cachedICloudCals(): ICloudCal[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

/** Writable iCloud calendars; [] when iCloud writing isn't configured on the server. */
export async function listICloudCals(token: string, calId: string): Promise<ICloudCal[]> {
  if (!WORKER) return [];
  try {
    const { calendars } = await call<{ calendars: ICloudCal[] }>('/icloud/calendars', { token, calId });
    try {
      localStorage.setItem(KEY, JSON.stringify(calendars));
    } catch {
      /* ignore */
    }
    return calendars;
  } catch (e) {
    if ((e as { code?: string }).code === 'not_configured') return [];
    throw e;
  }
}

export const createICloudEvent = (token: string, calId: string, cal: string, event: NewEvent) =>
  call<{ ok: true; calendar: string }>('/icloud/create', { token, calId, cal, event });

export const updateICloudEvent = (token: string, calId: string, uid: string, event: NewEvent & { endDate?: string }) =>
  call<{ ok: true; calendar: string }>('/icloud/update', { token, calId, uid, event });

export const deleteICloudEvent = (token: string, calId: string, uid: string) =>
  call<{ ok: true; calendar: string }>('/icloud/delete', { token, calId, uid });

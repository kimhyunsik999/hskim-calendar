import { addDays, dateInSeoul, timeInSeoul, type DateStr } from '../lib/date';
import type { Shift } from '../lib/shift';

const BASE = 'https://www.googleapis.com/calendar/v3';
export const APP_TAG = 'hskim-calendar';

export class AuthError extends Error {}

async function call<T>(token: string, path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
  const r = await fetch(BASE + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  });
  if (r.status === 401) throw new AuthError('Google 로그인이 만료되었습니다. 다시 연결해주세요.');
  if ((r.status === 403 || r.status === 429) && attempt < 4) {
    const body = await r.text();
    if (/rateLimit|quota/i.test(body)) {
      await new Promise((res) => setTimeout(res, 500 * 2 ** attempt));
      return call(token, path, init, attempt + 1);
    }
    throw new Error(`Google API ${r.status}: ${body.slice(0, 200)}`);
  }
  if (!r.ok) throw new Error(`Google API ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (r.status === 204 ? undefined : await r.json()) as T;
}

const enc = encodeURIComponent;

// ---------- calendars ----------

export type GCalendar = {
  id: string;
  summary: string;
  summaryOverride?: string;
  backgroundColor?: string;
  accessRole: 'owner' | 'writer' | 'reader' | 'freeBusyReader';
  primary?: boolean;
  selected?: boolean;
};

export async function listCalendars(token: string): Promise<GCalendar[]> {
  const r = await call<{ items: GCalendar[] }>(token, '/users/me/calendarList?maxResults=250');
  return r.items;
}

export const createCalendar = (token: string, summary: string) =>
  call<{ id: string }>(token, '/calendars', {
    method: 'POST',
    body: JSON.stringify({ summary, timeZone: 'Asia/Seoul', description: '4조 근무표 앱 공유 캘린더 (근무·변경·메모)' }),
  });

export const shareCalendar = (token: string, calId: string, email: string) =>
  call(token, `/calendars/${enc(calId)}/acl?sendNotifications=true`, {
    method: 'POST',
    body: JSON.stringify({ role: 'writer', scope: { type: 'user', value: email } }),
  });

/** Add a calendar someone shared with us to our list. Already-present is fine. */
export async function subscribeCalendar(token: string, calId: string) {
  try {
    await call(token, '/users/me/calendarList', { method: 'POST', body: JSON.stringify({ id: calId }) });
  } catch (e) {
    if (!(e instanceof Error) || !/\b409\b/.test(e.message)) throw e;
  }
}

// ---------- events ----------

export type Kind = 'shift' | 'override' | 'monthMemo';

export type GEvent = {
  id: string;
  summary?: string;
  description?: string;
  status?: string;
  colorId?: string;
  start: { date?: string; dateTime?: string };
  end: { date?: string; dateTime?: string };
  extendedProperties?: { shared?: Record<string, string> };
  reminders?: { useDefault: boolean; overrides?: { method: string; minutes: number }[] };
};

export async function listEvents(
  token: string,
  calId: string,
  from: DateStr,
  toInclusive: DateStr,
  kind?: Kind,
): Promise<GEvent[]> {
  const out: GEvent[] = [];
  let pageToken = '';
  do {
    const q = new URLSearchParams({
      timeMin: `${from}T00:00:00+09:00`,
      timeMax: `${addDays(toInclusive, 1)}T00:00:00+09:00`,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '2500',
    });
    if (kind) q.append('sharedExtendedProperty', `kind=${kind}`);
    if (pageToken) q.set('pageToken', pageToken);
    const r = await call<{ items: GEvent[]; nextPageToken?: string }>(token, `/calendars/${enc(calId)}/events?${q}`);
    out.push(...r.items.filter((e) => e.status !== 'cancelled'));
    pageToken = r.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

export const insertEvent = (token: string, calId: string, ev: Partial<GEvent>) =>
  call<GEvent>(token, `/calendars/${enc(calId)}/events`, { method: 'POST', body: JSON.stringify(ev) });

export const patchEvent = (token: string, calId: string, id: string, ev: Partial<GEvent>) =>
  call<GEvent>(token, `/calendars/${enc(calId)}/events/${enc(id)}`, { method: 'PATCH', body: JSON.stringify(ev) });

export async function deleteEvent(token: string, calId: string, id: string) {
  try {
    await call(token, `/calendars/${enc(calId)}/events/${enc(id)}`, { method: 'DELETE' });
  } catch (e) {
    if (!(e instanceof Error) || !/\b(404|410)\b/.test(e.message)) throw e;
  }
}

/** All-day event payload for the given inclusive date. */
export const allDay = (date: DateStr) => ({ start: { date }, end: { date: addDays(date, 1) } });

export const tag = (kind: Kind, extra: Record<string, string> = {}) => ({
  extendedProperties: { shared: { app: APP_TAG, kind, ...extra } },
});

// ---------- normalized view model ----------

export type CalEvent = {
  id: string;
  calendarId: string;
  calendarName: string;
  title: string;
  description?: string;
  /** inclusive, Korea-local */
  start: DateStr;
  end: DateStr;
  allDay: boolean;
  time?: string;
  color: string;
  kind?: Kind;
  shift?: Shift;
};

const EVENT_COLORS: Record<string, string> = {
  '1': '#7986cb', '2': '#33b679', '3': '#8e24aa', '4': '#e67c73', '5': '#f6bf26', '6': '#f4511e',
  '7': '#039be5', '8': '#616161', '9': '#3f51b5', '10': '#0b8043', '11': '#d50000',
};

export function normalize(e: GEvent, cal: { id: string; name: string; color: string }): CalEvent {
  const allDayEv = !!e.start.date;
  let start: DateStr, end: DateStr, time: string | undefined;
  if (allDayEv) {
    start = e.start.date!;
    end = addDays(e.end.date!, -1);
  } else {
    const s = new Date(e.start.dateTime!);
    const en = new Date(new Date(e.end.dateTime!).getTime() - 1);
    start = dateInSeoul(s);
    end = dateInSeoul(en);
    if (end < start) end = start;
    time = timeInSeoul(s);
  }
  const shared = e.extendedProperties?.shared;
  const isOurs = shared?.app === APP_TAG;
  return {
    id: e.id,
    calendarId: cal.id,
    calendarName: cal.name,
    title: e.summary ?? '(제목 없음)',
    description: e.description,
    start,
    end,
    allDay: allDayEv,
    time,
    color: (e.colorId && EVENT_COLORS[e.colorId]) || cal.color,
    kind: isOurs ? (shared?.kind as Kind) : undefined,
    shift: isOurs ? (shared?.shift as Shift | undefined) : undefined,
  };
}

// iCloud CalDAV write access for the 4조 근무표 app.
//  POST /icloud/calendars { token, calId }                        → writable iCloud calendars [{ id, name, color }]
//  POST /icloud/create    { token, calId, cal, event }             → create an event in iCloud calendar `cal` (id from the list)
// Auth to iCloud: the account owner's Apple ID + an app-specific password (Worker secrets ICLOUD_USER, ICLOUD_APP_PASSWORD).
// Callers must prove they belong to the shared Google calendar (same check as push), so only the couple can write.

import { PushError as HttpError, whoCanSee } from './push.js';

const ROOT = 'https://caldav.icloud.com';

const basic = (env) => 'Basic ' + btoa(unescape(encodeURIComponent(`${env.ICLOUD_USER}:${env.ICLOUD_APP_PASSWORD}`)));

async function dav(env, url, method, body, depth) {
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: basic(env),
      'Content-Type': 'application/xml; charset=utf-8',
      ...(depth != null ? { Depth: String(depth) } : {}),
    },
    body,
  });
  if (r.status === 401) throw new HttpError(502, 'icloud_auth', 'iCloud 로그인 실패 (Apple ID 또는 앱 전용 암호 확인)');
  if (r.status >= 400) throw new HttpError(502, 'icloud_error', `iCloud ${method} ${r.status}`);
  return r.text();
}

// --- tiny namespace-agnostic XML helpers (Workers have no DOMParser) ---
const tag = (name) => new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*?(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>)`, 'i');
const first = (xml, name) => {
  const m = xml.match(tag(name));
  return m ? (m[1] ?? '') : null;
};
const responses = (xml) => xml.match(/<(?:[\w-]+:)?response\b[\s\S]*?<\/(?:[\w-]+:)?response>/gi) ?? [];
const hrefIn = (xml) => (first(xml, 'href') ?? '').trim();
const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const abs = (href, base) => new URL(unxml(href), base).toString();

/** Writable VEVENT calendars of the configured iCloud account. */
export async function listCalendars(env) {
  const principalXml = await dav(
    env,
    ROOT + '/',
    'PROPFIND',
    '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>',
    0,
  );
  const principal = hrefIn(first(principalXml, 'current-user-principal') ?? '');
  if (!principal) throw new HttpError(502, 'icloud_error', 'iCloud principal not found');

  const homeXml = await dav(
    env,
    abs(principal, ROOT),
    'PROPFIND',
    '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>',
    0,
  );
  const home = abs(hrefIn(first(homeXml, 'calendar-home-set') ?? ''), ROOT);

  const listXml = await dav(
    env,
    home,
    'PROPFIND',
    `<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">
       <d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/><d:current-user-privilege-set/><a:calendar-color/></d:prop>
     </d:propfind>`,
    1,
  );
  const out = [];
  for (const r of responses(listXml)) {
    const type = first(r, 'resourcetype') ?? '';
    if (!/<(?:[\w-]+:)?calendar\b/i.test(type)) continue;
    const comps = first(r, 'supported-calendar-component-set') ?? '';
    if (comps && !/name=["']VEVENT["']/i.test(comps)) continue; // reminders lists etc. (iCloud uses single quotes)
    const priv = first(r, 'current-user-privilege-set') ?? '';
    if (!/<(?:[\w-]+:)?(write|write-content|all)\b/i.test(priv)) continue; // read-only shares
    const href = abs(hrefIn(r), home);
    const color = (first(r, 'calendar-color') ?? '').trim().slice(0, 7);
    out.push({ id: href, name: unxml((first(r, 'displayname') ?? '').trim()) || '이름 없음', color: /^#[0-9a-f]{6}$/i.test(color) ? color : '#e03131' });
  }
  return out;
}

// --- iCalendar building ---
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const fold = (line) => {
  // RFC 5545: lines ≤ 75 octets; continuation lines start with a space.
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts = [];
  let cur = '';
  for (const ch of line) {
    if (new TextEncoder().encode(cur + ch).length > (parts.length ? 74 : 75)) {
      parts.push(cur);
      cur = '';
    }
    cur += ch;
  }
  parts.push(cur);
  return parts.join('\r\n ');
};
const ymd = (d) => d.replace(/-/g, '');
const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/**
 * event: { title, date: 'YYYY-MM-DD', endDate?: 'YYYY-MM-DD' (inclusive, all-day), time?: 'HH:MM', minutes?: number, note? }
 */
export function buildIcs(event, uid, now = new Date()) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//hskim-calendar//4조 근무표//KO', 'CALSCALE:GREGORIAN'];
  if (event.time) {
    L.push('BEGIN:VTIMEZONE', 'TZID:Asia/Seoul', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900', 'TZNAME:KST', 'END:STANDARD', 'END:VTIMEZONE');
  }
  L.push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stamp(now)}`, `CREATED:${stamp(now)}`, `SUMMARY:${esc(event.title)}`);
  if (event.time) {
    const start = new Date(`${event.date}T${event.time}:00+09:00`);
    const end = new Date(start.getTime() + (event.minutes ?? 60) * 60_000);
    const local = (d) => {
      const k = new Date(d.getTime() + 9 * 3600_000).toISOString(); // shift to KST wall clock
      return k.slice(0, 19).replace(/[-:]/g, '');
    };
    L.push(`DTSTART;TZID=Asia/Seoul:${local(start)}`, `DTEND;TZID=Asia/Seoul:${local(end)}`);
  } else {
    const endExcl = new Date(`${event.endDate ?? event.date}T00:00:00Z`);
    endExcl.setUTCDate(endExcl.getUTCDate() + 1);
    L.push(`DTSTART;VALUE=DATE:${ymd(event.date)}`, `DTEND;VALUE=DATE:${ymd(endExcl.toISOString().slice(0, 10))}`, 'TRANSP:TRANSPARENT');
  }
  if (event.note) L.push(`DESCRIPTION:${esc(event.note)}`);
  L.push('END:VEVENT', 'END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

const validEvent = (e) =>
  e &&
  typeof e.title === 'string' &&
  e.title.trim() &&
  e.title.length <= 200 &&
  /^\d{4}-\d{2}-\d{2}$/.test(e.date) &&
  (e.endDate == null || /^\d{4}-\d{2}-\d{2}$/.test(e.endDate)) &&
  (e.time == null || /^\d{2}:\d{2}$/.test(e.time)) &&
  (e.minutes == null || (Number.isInteger(e.minutes) && e.minutes > 0 && e.minutes <= 24 * 60));

export async function handleICloud(path, body, env) {
  if (!env.ICLOUD_USER || !env.ICLOUD_APP_PASSWORD) throw new HttpError(501, 'not_configured', 'iCloud 쓰기가 설정되지 않았습니다.');
  const { token, calId } = body ?? {};
  if (typeof token !== 'string' || typeof calId !== 'string') throw new HttpError(400, 'bad_request', 'token and calId required');
  await whoCanSee(token, calId); // must be a member of the shared Google calendar

  if (path === '/icloud/calendars') return { calendars: await listCalendars(env) };

  if (path === '/icloud/create') {
    if (!validEvent(body.event)) throw new HttpError(400, 'bad_request', 'invalid event');
    // Only allow writing into a calendar of this account (never an arbitrary URL).
    const cals = await listCalendars(env);
    const cal = cals.find((c) => c.id === body.cal);
    if (!cal) throw new HttpError(404, 'not_found', '해당 iCloud 캘린더를 찾을 수 없습니다.');
    const uid = `${crypto.randomUUID()}@hskim-calendar`;
    const r = await fetch(new URL(`${encodeURIComponent(uid)}.ics`, cal.id.endsWith('/') ? cal.id : cal.id + '/').toString(), {
      method: 'PUT',
      headers: { Authorization: basic(env), 'Content-Type': 'text/calendar; charset=utf-8', 'If-None-Match': '*' },
      body: buildIcs(body.event, uid),
    });
    if (r.status === 401) throw new HttpError(502, 'icloud_auth', 'iCloud 로그인 실패');
    if (r.status >= 300) throw new HttpError(502, 'icloud_error', `iCloud PUT ${r.status}`);
    return { ok: true, uid, calendar: cal.name };
  }

  throw new HttpError(404, 'not_found', 'unknown route');
}

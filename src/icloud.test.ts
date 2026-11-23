import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error — plain JS Worker module
import { buildIcs, editIcs, handleICloud, listCalendars } from '../worker/src/icloud.js';

const env = { ICLOUD_USER: 'me@icloud.com', ICLOUD_APP_PASSWORD: 'abcd-efgh-ijkl-mnop' };

// Shapes modelled on iCloud CalDAV multistatus replies.
const PRINCIPAL = `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:"><response><href>/</href><propstat><prop><current-user-principal><href>/1234567/principal/</href></current-user-principal></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`;
const HOME = `<?xml version="1.0"?>
<multistatus xmlns="DAV:"><response><href>/1234567/principal/</href><propstat><prop><calendar-home-set xmlns="urn:ietf:params:xml:ns:caldav"><href xmlns="DAV:">https://p44-caldav.icloud.com:443/1234567/calendars/</href></calendar-home-set></prop></propstat></response></multistatus>`;
const priv = (w: boolean) =>
  `<current-user-privilege-set><privilege><read/></privilege>${w ? '<privilege><write/></privilege><privilege><write-content/></privilege>' : ''}</current-user-privilege-set>`;
const cal = (href: string, name: string, color: string, writable: boolean, comp = 'VEVENT') => `
<response><href>${href}</href><propstat><prop>
  <displayname>${name}</displayname>
  <resourcetype><collection/><calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype>
  <supported-calendar-component-set xmlns="urn:ietf:params:xml:ns:caldav"><comp name='${comp}' xmlns='urn:ietf:params:xml:ns:caldav'/></supported-calendar-component-set>
  ${priv(writable)}
  <calendar-color xmlns="http://apple.com/ns/ical/">${color}FF</calendar-color>
</prop><status>HTTP/1.1 200 OK</status></propstat></response>`;
const LIST = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">
<response xmlns="DAV:"><href>/1234567/calendars/</href><propstat><prop><resourcetype><collection/></resourcetype></prop></propstat></response>
${cal('/1234567/calendars/home/', '집', '#1BADF8', true)}
${cal('/1234567/calendars/FAMILY-1/', '가족', '#FF2968', true)}
${cal('/1234567/calendars/FAMILY-2/', '가족❣️', '#FF2968', true)}
${cal('/1234567/calendars/readonly/', '구독 전용', '#888888', false)}
${cal('/1234567/calendars/tasks/', '미리알림', '#00FF00', true, 'VTODO')}
</d:multistatus>`;

function fakeICloud() {
  const puts: { url: string; body: string; headers: Record<string, string> }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const h = (init.headers ?? {}) as Record<string, string>;
    if (url.includes('googleapis.com/calendar/v3/calendars/primary')) return Response.json({ id: 'h@gmail.com' });
    if (url.includes('googleapis.com/calendar')) return Response.json({ id: 'shared' });
    expect(h.Authorization).toBe('Basic ' + btoa('me@icloud.com:abcd-efgh-ijkl-mnop'));
    if (init.method === 'PROPFIND' && url === 'https://caldav.icloud.com/') return new Response(PRINCIPAL, { status: 207 });
    if (init.method === 'PROPFIND' && url.endsWith('/principal/')) return new Response(HOME, { status: 207 });
    if (init.method === 'PROPFIND') return new Response(LIST, { status: 207 });
    if (init.method === 'PUT') {
      puts.push({ url, body: String(init.body), headers: h });
      return new Response(null, { status: 201 });
    }
    throw new Error('unexpected ' + init.method + ' ' + url);
  });
  return puts;
}

describe('iCloud CalDAV', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists only writable event calendars, with absolute URLs and colors', async () => {
    fakeICloud();
    const cals = await listCalendars(env);
    expect(cals.map((c: { name: string }) => c.name)).toEqual(['집', '가족', '가족❣️']);
    expect(cals[1]).toEqual({ id: 'https://p44-caldav.icloud.com/1234567/calendars/FAMILY-1/', name: '가족', color: '#FF2968' });
  });

  it('creates a timed event in the chosen calendar (members only)', async () => {
    const puts = fakeICloud();
    const target = 'https://p44-caldav.icloud.com/1234567/calendars/FAMILY-2/'; // :443 normalized away
    const r = await handleICloud('/icloud/create', { token: 't', calId: 'shared', cal: target, event: { title: '수호, 소아과; 예방접종', date: '2026-11-28', time: '11:05', minutes: 30 } }, env);
    expect(r).toMatchObject({ ok: true, calendar: '가족❣️' });
    expect(puts).toHaveLength(1);
    expect(puts[0].url.startsWith(target)).toBe(true);
    expect(puts[0].url.endsWith('.ics')).toBe(true);
    expect(puts[0].headers['If-None-Match']).toBe('*');
    const ics = puts[0].body;
    expect(ics).toContain('DTSTART;TZID=Asia/Seoul:20261128T110500');
    expect(ics).toContain('DTEND;TZID=Asia/Seoul:20261128T113500');
    expect(ics).toContain('SUMMARY:수호\\, 소아과\\; 예방접종');
  });

  it('refuses calendars outside the account and bad input', async () => {
    fakeICloud();
    await expect(handleICloud('/icloud/create', { token: 't', calId: 'shared', cal: 'https://evil.example/cal/', event: { title: 'x', date: '2026-11-28' } }, env)).rejects.toMatchObject({ status: 404 });
    await expect(handleICloud('/icloud/create', { token: 't', calId: 'shared', cal: 'x', event: { title: '', date: '2026-11-28' } }, env)).rejects.toMatchObject({ status: 400 });
    await expect(handleICloud('/icloud/calendars', { token: 't', calId: 'shared' }, {})).rejects.toMatchObject({ status: 501 });
  });

  it('edits title/time but keeps alarms, notes and UID', () => {
    const orig = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Apple Inc.//iPhone OS 18.0//EN',
      'BEGIN:VEVENT', 'UID:ABC-123', 'DTSTAMP:20261120T010101Z', 'SUMMARY:테스트', 'DTSTART;VALUE=DATE:20261123', 'DTEND;VALUE=DATE:20261124',
      'DESCRIPTION:메모 유지', 'LOCATION:분당', 'SEQUENCE:2',
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT1H', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR', '',
    ].join('\r\n');
    const out = editIcs(orig, { title: '테스트 (수정)', date: '2026-11-24', time: '10:00', minutes: 90 }, new Date('2026-11-23T00:00:00Z'));
    expect(out).toContain('UID:ABC-123');
    expect(out).toContain('SUMMARY:테스트 (수정)');
    expect(out).toContain('DTSTART;TZID=Asia/Seoul:20261124T100000');
    expect(out).toContain('DTEND;TZID=Asia/Seoul:20261124T113000');
    expect(out).toContain('TZID:Asia/Seoul'); // VTIMEZONE added for the timed event
    expect(out).toContain('DESCRIPTION:메모 유지');
    expect(out).toContain('TRIGGER:-PT1H');
    expect(out).toContain('SEQUENCE:3');
    expect(out).not.toContain('VALUE=DATE:20261123');
    expect(out.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it('refuses to edit recurring events', () => {
    const rec = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:R\r\nSUMMARY:주간\r\nDTSTART:20261102T000000Z\r\nRRULE:FREQ=WEEKLY\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    expect(() => editIcs(rec, { title: 'x', date: '2026-11-02' })).toThrow(/반복 일정/);
  });

  it('finds by "<uid>.ics" first, else by time-range + UID (iCloud rejects UID filters), and writes without If-Match (iCloud mishandles it)', async () => {
    const puts = fakeICloud();
    const calls: { m: string; url: string; h: Record<string, string>; body?: string }[] = [];
    const prev = globalThis.fetch;
    const ICS = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:APPLE-UID\nSUMMARY:old &amp; new\nDTSTART;VALUE=DATE:20261123\nEND:VEVENT\nEND:VCALENDAR';
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      const m = init.method ?? 'GET';
      if (m === 'GET' && url.endsWith('.ics')) {
        calls.push({ m, url, h: {} });
        // Our own event lives at <uid>.ics; the Apple-made one doesn't.
        if (url === 'https://p44-caldav.icloud.com/1234567/calendars/FAMILY-2/OURS%40hskim-calendar.ics')
          return new Response('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:OURS@hskim-calendar\r\nSUMMARY:테스트\r\nDTSTART;VALUE=DATE:20261123\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n', { status: 200, headers: { ETag: '"etag-ours"' } });
        return new Response('', { status: 404 });
      }
      if (m === 'REPORT') {
        calls.push({ m, url, h: {}, body: String(init.body) });
        if (/prop-filter/.test(String(init.body))) return new Response('', { status: 412 }); // what iCloud does
        if (!url.includes('FAMILY-1')) return new Response('<multistatus xmlns="DAV:"></multistatus>', { status: 207 });
        return new Response(
          `<multistatus xmlns="DAV:"><response><href>/1234567/calendars/FAMILY-1/0F3A-random-name.ics</href><propstat><prop><getetag>"etag-apple"</getetag><calendar-data xmlns="urn:ietf:params:xml:ns:caldav">${ICS}</calendar-data></prop></propstat></response></multistatus>`,
          { status: 207 },
        );
      }
      if (m === 'DELETE' || m === 'PUT') {
        calls.push({ m, url, h: init.headers as Record<string, string> });
        return new Response(null, { status: 204 });
      }
      return prev(url, init);
    });

    // 1) our event: direct GET, no REPORT needed
    const r = await handleICloud('/icloud/update', { token: 't', calId: 'shared', uid: 'OURS@hskim-calendar', date: '2026-11-23', event: { title: '테스트2', date: '2026-11-23' } }, env);
    expect(r).toMatchObject({ ok: true, calendar: '가족❣️' });
    const put = calls.find((c) => c.m === 'PUT')!;
    expect(put.url).toBe('https://p44-caldav.icloud.com/1234567/calendars/FAMILY-2/OURS%40hskim-calendar.ics');
    expect(put.h['If-Match']).toBeUndefined(); // iCloud mishandles If-Match
    expect(calls.some((c) => c.m === 'REPORT')).toBe(false);

    // 2) Apple-made event with a different resource name: time-range REPORT around the date
    await handleICloud('/icloud/delete', { token: 't', calId: 'shared', uid: 'APPLE-UID', date: '2026-11-23' }, env);
    const rep = calls.find((c) => c.m === 'REPORT')!;
    expect(rep.body).toContain('time-range start="20261121T150000Z" end="20261124T150000Z"'); // 11/22 00:00 ~ 11/25 00:00 KST
    const del = calls.find((c) => c.m === 'DELETE')!;
    expect(del.url).toBe('https://p44-caldav.icloud.com/1234567/calendars/FAMILY-1/0F3A-random-name.ics');
    expect(del.h['If-Match']).toBeUndefined();

    // 3) not found without a date → 404
    await expect(handleICloud('/icloud/delete', { token: 't', calId: 'shared', uid: 'NOPE' }, env)).rejects.toMatchObject({ status: 404 });
    expect(puts).toHaveLength(0);
  });

  it('reads events of the chosen calendars in a KST date range (real-time path)', async () => {
    fakeICloud();
    const bodies: string[] = [];
    const prev = globalThis.fetch;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      if (init.method === 'REPORT') {
        bodies.push(`${url} ${init.body}`);
        return new Response(
          `<multistatus xmlns="DAV:"><response><href>/x/a.ics</href><propstat><prop><calendar-data xmlns="urn:ietf:params:xml:ns:caldav">BEGIN:VCALENDAR
BEGIN:VEVENT
UID:a
SUMMARY:수호 &amp; 지호
DTSTART;VALUE=DATE:20261127
END:VEVENT
END:VCALENDAR</calendar-data></prop></propstat></response></multistatus>`,
          { status: 207 },
        );
      }
      return prev(url, init);
    });
    const fam = 'https://p44-caldav.icloud.com/1234567/calendars/FAMILY-1/';
    const r = await handleICloud('/icloud/events', { token: 't', calId: 'shared', from: '2026-11-01', to: '2026-12-05', cals: [fam, 'https://evil.example/'] }, env);
    expect(r.calendars).toHaveLength(1); // unknown ids ignored
    expect(r.calendars[0]).toMatchObject({ id: fam, name: '가족' });
    expect(r.calendars[0].ics[0]).toContain('SUMMARY:수호 & 지호');
    expect(bodies[0]).toContain('time-range start="20261031T150000Z" end="20261205T150000Z"');
  });

  it('builds all-day (multi-day) events and folds long lines', () => {
    const ics = buildIcs({ title: '혜연 연차', date: '2026-12-31', endDate: '2027-01-02' }, 'u1', new Date('2026-11-23T00:00:00Z'));
    expect(ics).toContain('DTSTART;VALUE=DATE:20261231');
    expect(ics).toContain('DTEND;VALUE=DATE:20270103'); // exclusive end
    expect(ics).not.toContain('VTIMEZONE');
    const long = buildIcs({ title: '가'.repeat(60), date: '2026-12-01' }, 'u2');
    for (const line of long.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});

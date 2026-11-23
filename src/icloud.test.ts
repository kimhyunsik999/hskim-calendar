import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error — plain JS Worker module
import { buildIcs, handleICloud, listCalendars } from '../worker/src/icloud.js';

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
  <supported-calendar-component-set xmlns="urn:ietf:params:xml:ns:caldav"><comp name="${comp}"/></supported-calendar-component-set>
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

  it('builds all-day (multi-day) events and folds long lines', () => {
    const ics = buildIcs({ title: '혜연 연차', date: '2026-12-31', endDate: '2027-01-02' }, 'u1', new Date('2026-11-23T00:00:00Z'));
    expect(ics).toContain('DTSTART;VALUE=DATE:20261231');
    expect(ics).toContain('DTEND;VALUE=DATE:20270103'); // exclusive end
    expect(ics).not.toContain('VTIMEZONE');
    const long = buildIcs({ title: '가'.repeat(60), date: '2026-12-01' }, 'u2');
    for (const line of long.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});

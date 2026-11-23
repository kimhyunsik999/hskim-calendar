import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syncShifts, type ShiftCals } from './sync';
import type { GEvent } from './api';

/** Minimal in-memory Google Calendar events API (only what sync uses). */
function fakeGoogle() {
  const cals = new Map<string, Map<string, GEvent>>();
  let seq = 0;
  const cal = (id: string) => cals.get(id) ?? (cals.set(id, new Map()), cals.get(id)!);
  const calls = { insert: 0, patch: 0, delete: 0 };
  const startOf = (e: GEvent) => e.start.dateTime ?? `${e.start.date}T00:00:00+09:00`;
  const endOf = (e: GEvent) => e.end.dateTime ?? `${e.end.date}T00:00:00+09:00`;

  const fetchImpl = async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const m = url.pathname.match(/\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
    if (!m) throw new Error('unexpected ' + url.pathname);
    const c = cal(decodeURIComponent(m[1]));
    const id = m[2] && decodeURIComponent(m[2]);
    const method = init.method ?? 'GET';
    const json = (b: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(b), { status });
    if (method === 'GET') {
      const tmin = Date.parse(url.searchParams.get('timeMin')!);
      const tmax = Date.parse(url.searchParams.get('timeMax')!);
      const [k, v] = (url.searchParams.get('sharedExtendedProperty') ?? '=').split('=');
      const items = [...c.values()].filter(
        (e) => Date.parse(endOf(e)) > tmin && Date.parse(startOf(e)) < tmax && (!k || e.extendedProperties?.shared?.[k] === v),
      );
      return json({ items });
    }
    if (method === 'POST') {
      const e = { ...JSON.parse(init.body as string), id: 'ev' + seq++ } as GEvent;
      c.set(e.id, e);
      calls.insert++;
      return json(e);
    }
    if (method === 'PATCH') {
      const e = { ...c.get(id!)!, ...JSON.parse(init.body as string) } as GEvent;
      c.set(id!, e);
      calls.patch++;
      return json(e);
    }
    if (method === 'DELETE') {
      c.delete(id!);
      calls.delete++;
      return json(null, 204);
    }
    throw new Error(method);
  };
  return { cals, cal, calls, fetchImpl };
}

const MAIN = 'main';
const CALS: ShiftCals = { A: 'calA', B: 'calB', C: 'calC', 휴: 'calOff' };

describe('syncShifts (4 calendars)', () => {
  let g: ReturnType<typeof fakeGoogle>;
  beforeEach(() => {
    g = fakeGoogle();
    vi.stubGlobal('fetch', g.fetchImpl);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('puts each day into the calendar of its shift, with titles and reminders', async () => {
    // 2026-11-01..08 = C C 휴 휴 A A A A
    await syncShifts('t', MAIN, CALS, '2026-11-01', '2026-11-08', 60);
    const titles = (id: string) => [...g.cal(id).values()].map((e) => `${e.extendedProperties!.shared!.date} ${e.summary}`).sort();
    expect(titles('calC')).toEqual(['2026-11-01 🌙 C 야간 출근 23:00', '2026-11-02 🌙 C 야간 출근 23:00']);
    expect(titles('calOff')).toEqual(['2026-11-03 🟠 휴무', '2026-11-04 🟠 휴무']);
    expect(titles('calA')).toHaveLength(4);
    expect(g.cal('calB').size).toBe(0);
    const a = [...g.cal('calA').values()][0];
    expect(a.reminders?.overrides).toEqual([{ method: 'popup', minutes: 60 }]);
    const off = [...g.cal('calOff').values()][0];
    expect(off.start.date).toBe('2026-11-03');
    expect(off.reminders?.overrides).toEqual([]);
  });

  it('is idempotent', async () => {
    await syncShifts('t', MAIN, CALS, '2026-11-01', '2026-11-30', 60);
    const before = { ...g.calls };
    const n = await syncShifts('t', MAIN, CALS, '2026-11-01', '2026-11-30', 60);
    expect(n).toBe(0);
    expect(g.calls).toEqual(before);
  });

  it('migrates legacy shift events out of the main calendar', async () => {
    g.cal(MAIN).set('old1', {
      id: 'old1',
      summary: 'C 근무 (23:00-07:00)',
      start: { dateTime: '2026-11-01T23:00:00+09:00' },
      end: { dateTime: '2026-11-02T07:00:00+09:00' },
      extendedProperties: { shared: { app: 'hskim-calendar', kind: 'shift', date: '2026-11-01', shift: 'C', remind: '60' } },
    });
    g.cal(MAIN).set('memo', { id: 'memo', summary: '메모', start: { date: '2026-11-01' }, end: { date: '2026-11-02' } });
    await syncShifts('t', MAIN, CALS, '2026-11-01', '2026-11-01', 60);
    expect([...g.cal(MAIN).keys()]).toEqual(['memo']); // memo untouched, legacy shift removed
    expect(g.cal('calC').size).toBe(1);
  });

  it('moves a day to another calendar when overridden to 연차', async () => {
    await syncShifts('t', MAIN, CALS, '2026-11-05', '2026-11-05', 60);
    expect(g.cal('calA').size).toBe(1);
    g.cal(MAIN).set('ov', {
      id: 'ov',
      summary: '[근무변경] 연차',
      start: { date: '2026-11-05' },
      end: { date: '2026-11-06' },
      extendedProperties: { shared: { app: 'hskim-calendar', kind: 'override', shift: '연차', date: '2026-11-05' } },
    });
    await syncShifts('t', MAIN, CALS, '2026-11-05', '2026-11-05', 60);
    expect(g.cal('calA').size).toBe(0);
    expect([...g.cal('calOff').values()].map((e) => e.summary)).toEqual(['🌴 연차']);
  });
});

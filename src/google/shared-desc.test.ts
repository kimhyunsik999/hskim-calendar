import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GEvent } from './api';
import { readExternals, readSharedConfig, sharedExternalsOf, writeExternals } from './sync';

describe('shared iCloud list (config event, editable by both spouses)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('creates the config event once, then updates it in place', async () => {
    const events = new Map<string, GEvent>();
    let seq = 0;
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      const u = new URL(url);
      const method = init.method ?? 'GET';
      calls.push(method);
      if (method === 'GET') {
        const [, v] = (u.searchParams.get('sharedExtendedProperty') ?? '=').split('=');
        return Response.json({ items: [...events.values()].filter((e) => e.extendedProperties?.shared?.kind === v) });
      }
      const id = u.pathname.split('/events/')[1];
      const body = JSON.parse(init.body as string);
      const ev = method === 'POST' ? { ...body, id: `e${seq++}` } : { ...events.get(id)!, ...body };
      events.set(ev.id, ev);
      return Response.json(ev);
    });

    const fam = { id: 'ext:1', name: '가족', url: 'webcal://p193-caldav.icloud.com/published/2/x', color: '#e03131' };
    await writeExternals('t', 'main', [fam]); // husband
    expect(events.size).toBe(1);
    const ev = [...events.values()][0];
    expect(ev.start.date).toBe('2000-01-01'); // out of the way
    expect(ev.extendedProperties?.shared?.kind).toBe('config');

    const fam2 = { ...fam, id: 'ext:2', name: '가족2', url: 'webcal://p44-caldav.icloud.com/published/2/y' };
    await writeExternals('t', 'main', [fam, fam2]); // wife (writer) edits the same event
    expect(events.size).toBe(1);
    expect(calls.filter((m) => m === 'PATCH')).toHaveLength(1);
    expect(sharedExternalsOf(await readSharedConfig('t', 'main'))).toEqual([fam, fam2]);
  });

  it('still reads the legacy description line', () => {
    const list = [{ id: 'ext:1', name: '가족', url: 'webcal://p1-caldav.icloud.com/x', color: '#000' }];
    expect(readExternals(`intro\n[hskim-calendar-ext] ${JSON.stringify(list)}`)).toEqual(list);
    expect(readExternals('no line')).toBeNull();
    expect(sharedExternalsOf(null)).toBeNull();
  });
});

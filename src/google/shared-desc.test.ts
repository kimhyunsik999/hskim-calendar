import { afterEach, describe, expect, it, vi } from 'vitest';
import { readExternals, writeExternals } from './sync';

describe('shared calendar description', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stores the iCloud list without touching other lines (shift mapping)', async () => {
    let desc = '4조 근무표 앱 공유 캘린더\n[hskim-calendar] {"A":"a","B":"b","C":"c","휴":"h"}\n[hskim-calendar-ext] []';
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit = {}) => {
      if (init.method === 'PATCH') desc = JSON.parse(init.body as string).description;
      return Response.json({ id: 'main', summary: '4조 근무표', description: desc });
    });
    const list = [{ id: 'ext:1', name: '가족', url: 'webcal://p193-caldav.icloud.com/published/2/x', color: '#e03131' }];
    await writeExternals('t', 'main', list);
    expect(desc.split('\n')).toEqual(['4조 근무표 앱 공유 캘린더', '[hskim-calendar] {"A":"a","B":"b","C":"c","휴":"h"}', `[hskim-calendar-ext] ${JSON.stringify(list)}`]);
    expect(readExternals(desc)).toEqual(list);
    expect(readExternals('no line')).toBeNull();
    expect(readExternals('[hskim-calendar-ext] not json')).toBeNull();
  });
});

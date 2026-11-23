import { describe as d, expect, it } from 'vitest';
import { describe, icon, keyHour, leaveHour, shiftWeather, type Forecast } from './weather';

const h = (t: number, p: number, code: number, day = true) => ({ t, p, code, day });
const HOME: Forecast = {
  at: 0,
  loc: 'home',
  hours: {
    '2026-11-23T22': h(2, 70, 61, false), // leave for C
    '2026-11-24T06': h(-3, 10, 3), // leave for A
    '2026-11-25T12': h(10, 0, 1),
  },
};
const WORK: Forecast = {
  at: 0,
  loc: 'work',
  hours: {
    '2026-11-24T07': h(-1, 0, 2), // C ends next morning
    '2026-11-24T15': h(8, 0, 0), // A ends
  },
};

d('weather', () => {
  it('leaves home 1h before the shift', () => {
    expect([leaveHour('A'), leaveHour('B'), leaveHour('C')]).toEqual(['06', '14', '22']);
    expect(keyHour('2026-11-24', 'A')).toBe('2026-11-24T06');
    expect(keyHour('2026-11-25', '휴')).toBe('2026-11-25T12');
  });

  it('uses home for 출근 and work for 퇴근 (next morning for C)', () => {
    const c = shiftWeather(HOME, WORK, '2026-11-23', 'C', '2026-11-24')!;
    expect(c.leave!.p).toBe(70);
    expect(c.off!.t).toBe(-1);
    const a = shiftWeather(HOME, WORK, '2026-11-24', 'A', '2026-11-25')!;
    expect(a.leave!.t).toBe(-3);
    expect(a.off!.t).toBe(8);
    expect(shiftWeather(HOME, WORK, '2026-11-25', '휴', '2026-11-26')!.leave!.t).toBe(10);
    expect(shiftWeather(HOME, WORK, '2026-12-25', 'A', '2026-12-26')).toBeNull(); // beyond forecast
    expect(shiftWeather(null, WORK, '2026-11-24', 'A', '2026-11-25')!.leave).toBeUndefined(); // home off
  });

  it('maps WMO codes', () => {
    expect(icon(0)).toBe('☀️');
    expect(icon(0, false)).toBe('🌙');
    expect(icon(63)).toBe('🌧️');
    expect(icon(73)).toBe('🌨️');
    expect(describe(61)).toBe('비');
    expect(describe(3)).toBe('흐림');
  });
});

import { describe as d, expect, it } from 'vitest';
import { dayIcon, describe, icon, leaveTime, shiftWeather, type Forecast } from './weather';

const h = (t: number, p: number, code: number, day = true) => ({ t, p, code, day });
const HOME: Forecast = {
  at: 0,
  loc: 'home',
  hours: {
    // C on 11-23 leaves 21:30 → worse of 21h and 22h
    '2026-11-23T21': h(4, 20, 3, false),
    '2026-11-23T22': h(2, 70, 61, false),
    // A on 11-24 leaves 05:30 → worse of 05h and 06h
    '2026-11-24T05': h(-4, 10, 3),
    '2026-11-24T06': h(-3, 30, 1),
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
  it('leaves home 1h30 before the shift', () => {
    expect([leaveTime('A'), leaveTime('B'), leaveTime('C')]).toEqual(['05:30', '13:30', '21:30']);
  });

  it('uses the worse of the two hours around a half-hour departure', () => {
    const c = shiftWeather(HOME, WORK, '2026-11-23', 'C', '2026-11-24')!;
    expect(c.leave).toEqual({ t: 2, p: 70, code: 61, day: false });
    const a = dayIcon(HOME, '2026-11-24', 'A')!;
    expect(a).toEqual({ t: -4, p: 30, code: 3, day: true });
  });

  it('uses home for 출근 and work for 퇴근 (next morning for C)', () => {
    const c = shiftWeather(HOME, WORK, '2026-11-23', 'C', '2026-11-24')!;
    expect(c.off!.t).toBe(-1);
    expect(shiftWeather(HOME, WORK, '2026-11-24', 'A', '2026-11-25')!.off!.t).toBe(8);
    expect(shiftWeather(HOME, WORK, '2026-11-25', '휴', '2026-11-26')!.leave!.t).toBe(10);
    expect(dayIcon(HOME, '2026-11-25', '휴')!.t).toBe(10);
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

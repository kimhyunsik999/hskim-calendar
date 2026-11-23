import { describe as d, expect, it } from 'vitest';
import { describe, icon, keyHour, shiftWeather, type Forecast } from './weather';

const h = (t: number, p: number, code: number, day = true) => ({ t, p, code, day });
const F: Forecast = {
  at: 0,
  loc: '',
  hours: {
    '2026-11-23T23': h(2, 70, 61, false),
    '2026-11-24T07': h(-1, 10, 3),
    '2026-11-24T15': h(8, 0, 0),
    '2026-11-25T12': h(10, 0, 1),
  },
};

d('weather', () => {
  it('picks the shift start hour (and next-morning end for C)', () => {
    expect(keyHour('2026-11-24', 'A')).toBe('2026-11-24T07');
    expect(keyHour('2026-11-24', 'B')).toBe('2026-11-24T15');
    expect(keyHour('2026-11-23', 'C')).toBe('2026-11-23T23');
    expect(keyHour('2026-11-25', '휴')).toBe('2026-11-25T12');
    const c = shiftWeather(F, '2026-11-23', 'C', '2026-11-24')!;
    expect(c.start.p).toBe(70);
    expect(c.end!.t).toBe(-1);
    expect(shiftWeather(F, '2026-11-25', '휴', '2026-11-26')!.start.t).toBe(10);
    expect(shiftWeather(F, '2026-12-25', 'A', '2026-12-26')).toBeNull(); // beyond forecast
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

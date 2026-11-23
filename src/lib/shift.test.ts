import { describe, expect, it } from 'vitest';
import { addDays, monthGrid } from './date';
import { baseShift, effectiveShift, shiftInterval } from './shift';
import { lunarLabel } from './korean';
import { buildShiftIcs } from './ics';

// Transcribed from the user's 오늘근무 screenshots (4조), 2026-11-01 .. 2027-01-02.
const EXPECTED =
  'CC휴휴AAAAAA휴휴BBBBBB휴휴CCCCCC휴휴AA' + // Nov 1-30
  'AAAA휴휴BBBBBB휴휴CCCCCC휴휴AAAAAA휴휴B' + // Dec 1-31
  'BB'; // Jan 1-2

describe('4조 rotation', () => {
  it('matches the source app for Nov 2026 – Jan 2027', () => {
    const got = [...EXPECTED].map((_, i) => baseShift(addDays('2026-11-01', i))).join('');
    expect(got).toBe(EXPECTED);
  });

  it('is periodic over 24 days, backwards too', () => {
    for (let i = -400; i < 400; i++) {
      const d = addDays('2026-11-05', i);
      expect(baseShift(addDays(d, 24))).toBe(baseShift(d));
    }
  });

  it('applies overrides', () => {
    expect(effectiveShift('2026-11-05', { '2026-11-05': '연차' })).toBe('연차');
    expect(effectiveShift('2026-11-06', { '2026-11-05': '연차' })).toBe('A');
  });

  it('night shift ends next morning', () => {
    expect(shiftInterval('2026-11-30', 'C')).toEqual({
      start: '2026-11-30T23:00:00+09:00',
      end: '2026-12-01T07:00:00+09:00',
    });
    expect(shiftInterval('2026-11-05', 'A').end).toBe('2026-11-05T15:00:00+09:00');
  });
});

describe('calendar helpers', () => {
  it('builds Sunday-first grids like the source app', () => {
    const nov = monthGrid(2026, 11);
    expect(nov.length).toBe(35);
    expect(nov[0]).toBe('2026-11-01');
    expect(nov.at(-1)).toBe('2026-12-05');
    const dec = monthGrid(2026, 12);
    expect(dec[0]).toBe('2026-11-29');
    expect(dec.at(-1)).toBe('2027-01-02');
  });

  it('shows lunar 1st/15th like the screenshots', () => {
    expect(lunarLabel('2026-11-23')).toBe('10.15');
    expect(lunarLabel('2026-12-09')).toBe('11.01');
    expect(lunarLabel('2026-12-23')).toBe('11.15');
    expect(lunarLabel('2026-11-24')).toBeNull();
  });

  it('emits an ICS feed with work days only', () => {
    const ics = buildShiftIcs('2026-11-01', '2026-11-08', 60);
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(6); // C C 휴 휴 A A A A
    expect(ics).toContain('DTSTART;TZID=Asia/Seoul:20261101T230000');
    expect(ics).toContain('DTEND;TZID=Asia/Seoul:20261102T070000');
    expect(ics).toContain('TRIGGER:-PT60M');
  });
});

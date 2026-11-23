import { addDays, diffDays, type DateStr } from './date';

/** SK hynix 4조 3교대 — 4조 rotation. */
export type WorkShift = 'A' | 'B' | 'C';
export type Shift = WorkShift | '휴' | '연차';

export const SHIFT_OPTIONS: Shift[] = ['A', 'B', 'C', '휴', '연차'];

/** 24-day cycle: 6 days each of A/B/C, each followed by 2 days off. */
export const CYCLE: readonly Shift[] = [
  ...Array<Shift>(6).fill('A'), '휴', '휴',
  ...Array<Shift>(6).fill('B'), '휴', '휴',
  ...Array<Shift>(6).fill('C'), '휴', '휴',
];

/** 2026-11-05 is day 1 of an A block for 4조 (verified against the 오늘근무 app, 2026-11 ~ 2027-01). */
export const ANCHOR: DateStr = '2026-11-05';

/** Shift hours. C starts at 23:00 on its own date and ends 07:00 the next day. */
export const SHIFT_TIMES: Record<WorkShift, { start: string; end: string; label: string }> = {
  A: { start: '07:00', end: '15:00', label: '주간' },
  B: { start: '15:00', end: '23:00', label: '오후' },
  C: { start: '23:00', end: '07:00', label: '야간' },
};

export const isWork = (s: Shift): s is WorkShift => s === 'A' || s === 'B' || s === 'C';

export function baseShift(date: DateStr): Shift {
  const n = CYCLE.length;
  return CYCLE[((diffDays(date, ANCHOR) % n) + n) % n];
}

export type Overrides = Record<DateStr, Shift>;

export const effectiveShift = (date: DateStr, overrides: Overrides): Shift =>
  overrides[date] ?? baseShift(date);

/** Start/end as ISO strings with +09:00 offset. */
export function shiftInterval(date: DateStr, s: WorkShift) {
  const t = SHIFT_TIMES[s];
  const endDate = t.end <= t.start ? addDays(date, 1) : date;
  return {
    start: `${date}T${t.start}:00+09:00`,
    end: `${endDate}T${t.end}:00+09:00`,
  };
}

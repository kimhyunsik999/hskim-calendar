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

/**
 * Calendar event title. C is labelled by its start ("출근 23:00") because iPhone 캘린더 also lists
 * the previous night's C on the next morning as "종료 오전 7:00" — this keeps the two lines distinct.
 */
export const SHIFT_TITLES: Record<WorkShift, string> = {
  A: '☀️ A 주간 07:00-15:00',
  B: '🌆 B 오후 15:00-23:00',
  C: '🌙 C 야간 출근 23:00',
};

export const OFF_TITLES: Record<'휴' | '연차', string> = { 휴: '🟠 휴무', 연차: '🌴 연차' };

/** Bump when synced event content (title etc.) changes, so devices re-sync once automatically. */
export const SYNC_VERSION = 3;

// ---------- colors ----------

export type ShiftColors = Record<Shift, string>;

export const DEFAULT_COLORS: ShiftColors = {
  A: '#1c7ed6', // 주간 — 파랑
  B: '#f2b705', // 오후 — 노랑
  C: '#6741d9', // 야간 — 보라
  휴: '#e8590c', // 휴무 — 주황
  연차: '#2f9e44', // 연차 — 초록
};

/** Readable text color (black/white) on top of a hex background. */
export function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#1d1d1f' : '#ffffff';
}

/** Which of the 4 Google shift calendars a shift belongs to (연차 shares the 휴무 calendar). */
export type ShiftCalKey = 'A' | 'B' | 'C' | '휴';
export const calKeyOf = (s: Shift): ShiftCalKey => (s === '연차' ? '휴' : s);
export const SHIFT_CAL_NAMES: Record<ShiftCalKey, string> = { A: '4조 A 주간', B: '4조 B 오후', C: '4조 C 야간', 휴: '4조 휴무' };

export const isWork =(s: Shift): s is WorkShift => s === 'A' || s === 'B' || s === 'C';

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

// All dates are handled as 'YYYY-MM-DD' strings in Korea time (Asia/Seoul, no DST).

export type DateStr = string;

export const TZ = 'Asia/Seoul';
const DAY_MS = 86_400_000;

export const pad = (n: number) => String(n).padStart(2, '0');

export const ymd = (y: number, m: number, d: number): DateStr => `${y}-${pad(m)}-${pad(d)}`;

export function parts(s: DateStr): [number, number, number] {
  const [y, m, d] = s.split('-').map(Number);
  return [y, m, d];
}

const toUTC = (s: DateStr) => {
  const [y, m, d] = parts(s);
  return Date.UTC(y, m - 1, d);
};

export const diffDays = (a: DateStr, b: DateStr) => Math.round((toUTC(a) - toUTC(b)) / DAY_MS);

export function addDays(s: DateStr, n: number): DateStr {
  const t = new Date(toUTC(s) + n * DAY_MS);
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** 0 = Sunday */
export const weekday = (s: DateStr) => new Date(toUTC(s)).getUTCDay();

export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const seoulDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const seoulTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Korea-local date of an instant. */
export const dateInSeoul = (d: Date): DateStr => seoulDate.format(d);
/** Korea-local HH:MM of an instant. */
export const timeInSeoul = (d: Date) => seoulTime.format(d).replace(/^24/, '00');

export const today = (): DateStr => dateInSeoul(new Date());

export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Sunday-first grid covering the whole month (5 or 6 weeks). */
export function monthGrid(y: number, m: number): DateStr[] {
  const first = ymd(y, m, 1);
  const start = addDays(first, -weekday(first));
  const weeks = Math.ceil((weekday(first) + daysInMonth(y, m)) / 7);
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
}

export function shiftMonth(y: number, m: number, delta: number) {
  const idx = y * 12 + (m - 1) + delta;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

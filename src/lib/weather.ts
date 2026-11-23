// Hourly forecast from Open-Meteo (free, no API key, CORS-enabled). Up to 14 days ahead.
import type { DateStr } from './date';
import { isWork, SHIFT_TIMES, type Shift } from './shift';

export type WeatherLoc = { id: string; name: string; lat: number; lon: number };

/** 회사 (퇴근 시각 날씨). */
export const WORK_PRESETS: WeatherLoc[] = [
  { id: 'icheon', name: '이천캠퍼스', lat: 37.258, lon: 127.486 },
  { id: 'cheongju', name: '청주캠퍼스', lat: 36.665, lon: 127.404 },
];
/** 집 (출근 출발 시각 날씨). */
export const HOME_PRESETS: WeatherLoc[] = [{ id: 'gwangju-gg', name: '경기 광주', lat: 37.429, lon: 127.255 }];
/** @deprecated kept for older settings; same as WORK_PRESETS */
export const WEATHER_PRESETS = WORK_PRESETS;

/** Minutes before shift start that you leave home (user: "보통 한시간반 잡고 출발"). */
export const LEAVE_BEFORE_MIN = 90;

export type Hour = { t: number; p: number; code: number; day: boolean };
/** Keyed by 'YYYY-MM-DDTHH' (Korea time). */
export type Forecast = { at: number; loc: string; hours: Record<string, Hour> };

export async function fetchForecast(loc: WeatherLoc): Promise<Forecast> {
  const q = new URLSearchParams({
    latitude: String(loc.lat),
    longitude: String(loc.lon),
    hourly: 'temperature_2m,precipitation_probability,weather_code,is_day',
    timezone: 'Asia/Seoul',
    forecast_days: '14',
    past_days: '1',
  });
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
  if (!r.ok) throw new Error(`날씨를 불러오지 못했습니다 (${r.status})`);
  const j = (await r.json()) as {
    hourly: { time: string[]; temperature_2m: number[]; precipitation_probability: (number | null)[]; weather_code: number[]; is_day: number[] };
  };
  const h = j.hourly;
  const hours: Record<string, Hour> = {};
  h.time.forEach((t, i) => {
    hours[t.slice(0, 13)] = { t: h.temperature_2m[i], p: h.precipitation_probability[i] ?? 0, code: h.weather_code[i], day: h.is_day[i] === 1 };
  });
  return { at: Date.now(), loc: `${loc.lat},${loc.lon}`, hours };
}

/** WMO weather code → emoji. */
export function icon(code: number, day = true): string {
  if (code === 0) return day ? '☀️' : '🌙';
  if (code <= 2) return day ? '🌤️' : '☁️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 57) return '🌦️';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return '🌧️';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return '🌨️';
  if (code >= 95) return '⛈️';
  return '☁️';
}

export const DESC: [number, string][] = [
  [0, '맑음'], [2, '구름 조금'], [3, '흐림'], [48, '안개'], [57, '이슬비'], [67, '비'], [77, '눈'], [82, '소나기'], [86, '눈'], [99, '뇌우'],
];
export const describe = (code: number) => DESC.find(([max]) => code <= max)?.[1] ?? '';

const hourOf = (hhmm: string) => Number(hhmm.slice(0, 2));
const pad2 = (n: number) => String(n).padStart(2, '0');
const toMin = (hhmm: string) => hourOf(hhmm) * 60 + Number(hhmm.slice(3, 5));

/** Time you leave home for a work day ('HH:MM'), e.g. A 07:00 − 1:30 → '05:30'. */
export function leaveTime(shift: 'A' | 'B' | 'C'): string {
  const m = (toMin(SHIFT_TIMES[shift].start) - LEAVE_BEFORE_MIN + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** Worse of two hourly forecasts — used when departure falls between two hours (e.g. 05:30). */
const worse = (a: Hour, b: Hour): Hour => ({ t: Math.min(a.t, b.t), p: Math.max(a.p, b.p), code: Math.max(a.code, b.code), day: a.day });

/** Forecast at an 'HH:MM' on a date: exact hour, or the worse of the two surrounding hours. */
function at(f: Forecast | null, date: DateStr, hhmm: string): Hour | undefined {
  if (!f) return undefined;
  const h = hourOf(hhmm);
  const a = f.hours[`${date}T${pad2(h)}`];
  if (hhmm.endsWith(':00') || h === 23) return a;
  const b = f.hours[`${date}T${pad2(h + 1)}`];
  return a && b ? worse(a, b) : (a ?? b);
}

/** What the month grid shows: leaving home on work days, noon on days off. */
export function dayIcon(home: Forecast | null, date: DateStr, shift: Shift): Hour | undefined {
  return isWork(shift) ? at(home, date, leaveTime(shift)) : home?.hours[`${date}T12`];
}

/**
 * 출근 = home forecast when leaving (1:30 before start); 퇴근 = work forecast at shift end
 * (next morning for C). Days off: home at noon.
 */
export function shiftWeather(home: Forecast | null, work: Forecast | null, date: DateStr, shift: Shift, nextDate: DateStr) {
  if (!isWork(shift)) {
    const noon = home?.hours[`${date}T12`];
    return noon ? { leave: noon } : null;
  }
  const { start, end } = SHIFT_TIMES[shift];
  const endDate = end <= start ? nextDate : date;
  const leave = at(home, date, leaveTime(shift));
  const off = at(work, endDate, end);
  return leave || off ? { leave, off } : null;
}

/** Worth flagging: rain/snow likely or freezing. */
export const isAlert = (h: Hour) => h.p >= 50 || h.code >= 51 || h.t <= -5;

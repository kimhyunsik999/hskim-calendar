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

/** Hours before shift start that you leave home. */
export const LEAVE_BEFORE_H = 1;

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

/** Hour you leave home for a work day ('HH'), e.g. A 07:00 → '06'. */
export const leaveHour = (shift: 'A' | 'B' | 'C') => pad2((hourOf(SHIFT_TIMES[shift].start) - LEAVE_BEFORE_H + 24) % 24);

/** The hour shown on the month grid: leaving home on work days, noon on days off. */
export function keyHour(date: DateStr, shift: Shift): string {
  return `${date}T${isWork(shift) ? leaveHour(shift) : '12'}`;
}

/**
 * 출근 = home forecast when leaving (1h before start); 퇴근 = work forecast at shift end
 * (next morning for C). Days off: home at noon.
 */
export function shiftWeather(home: Forecast | null, work: Forecast | null, date: DateStr, shift: Shift, nextDate: DateStr) {
  if (!isWork(shift)) {
    const noon = home?.hours[`${date}T12`];
    return noon ? { leave: noon } : null;
  }
  const { start, end } = SHIFT_TIMES[shift];
  const endDate = end <= start ? nextDate : date;
  const leave = home?.hours[keyHour(date, shift)];
  const off = work?.hours[`${endDate}T${pad2(hourOf(end))}`];
  return leave || off ? { leave, off } : null;
}

/** Worth flagging: rain/snow likely or freezing. */
export const isAlert = (h: Hour) => h.p >= 50 || h.code >= 51 || h.t <= -5;

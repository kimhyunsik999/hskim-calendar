import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchExternal, type ExtCal } from './lib/externalIcs';
import { fetchForecast, WEATHER_PRESETS, type Forecast, type WeatherLoc } from './lib/weather';
import { AuthError, listCalendars, listEvents, normalize, subscribeCalendar, type CalEvent, type GCalendar } from './google/api';
import { clearToken, initGis, requestToken, revoke, storedToken, type Token } from './google/gis';
import type { DateStr } from './lib/date';
import type { Overrides, ShiftColors } from './lib/shift';
import type { ShiftCals } from './google/sync';

// ---------- local storage (per-device conveniences only; shared data lives in Google) ----------

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable — fine */
  }
}

export type Settings = {
  /** Shared 4조 calendar in Google (shifts, overrides, memos). */
  sharedCalId: string | null;
  /** Calendars to overlay; null = whatever is checked in Google Calendar. */
  visibleCalIds: string[] | null;
  /** Popup reminder before each shift, minutes. 0 = off. */
  reminderMin: number;
  syncDays: number;
  /** SYNC_VERSION of the last successful shift sync on this device. */
  syncedVersion?: number;
  /** Per-shift Google calendars, cached for the main calendar they belong to. */
  shiftCals?: { main: string; cals: ShiftCals } | null;
  /** Badge / calendar colors chosen on this device. */
  colors?: Partial<ShiftColors>;
  /** iCloud etc. calendars added by public ICS link (this device). */
  externals?: ExtCal[];
  /** Weather location: a preset id, 'gps' (custom coords), or 'off'. Default 이천. */
  weather?: { id: string; lat?: number; lon?: number };
};

// ---------- weather ----------

export function weatherLocOf(s: Settings): WeatherLoc | null {
  const w = s.weather ?? { id: 'icheon' };
  if (w.id === 'off') return null;
  if (w.id === 'gps' && w.lat != null && w.lon != null) return { id: 'gps', name: '현재 위치', lat: w.lat, lon: w.lon };
  return WEATHER_PRESETS.find((p) => p.id === w.id) ?? WEATHER_PRESETS[0];
}

export function useWeather(loc: WeatherLoc | null) {
  const [f, setF] = useState<Forecast | null>(() => load<Forecast | null>('hc.weather', null));
  const key = loc ? `${loc.lat},${loc.lon}` : '';
  useEffect(() => {
    if (!loc) return;
    const refresh = () => {
      const cur = load<Forecast | null>('hc.weather', null);
      if (cur && cur.loc === key && Date.now() - cur.at < 60 * 60_000) return setF(cur);
      fetchForecast(loc).then(
        (n) => {
          setF(n);
          save('hc.weather', n);
        },
        () => undefined, // offline: keep the cached forecast
      );
    };
    refresh();
    const v = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', v);
    return () => document.removeEventListener('visibilitychange', v);
  }, [key]); // loc is fully described by key
  return loc && f?.loc === key ? f : null;
}

// ---------- external (iCloud) calendars ----------

export function useExternalEvents(externals: ExtCal[] | undefined, from: DateStr, to: DateStr) {
  const key = `hc.ext.${from}.${to}`;
  const [events, setEvents] = useState<CalEvent[]>(() => load(key, []));
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const list = useMemo(() => externals ?? [], [externals]);

  useEffect(() => {
    setEvents(load(key, []));
    if (!list.length) {
      setEvents([]);
      return;
    }
    let alive = true;
    Promise.allSettled(list.map((c) => fetchExternal(c, from, to))).then((rs) => {
      if (!alive) return;
      const ok = rs.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
      const failed = rs.flatMap((r) => (r.status === 'rejected' ? [(r.reason as Error).message] : []));
      setEvents(ok);
      if (!failed.length) save(key, ok);
      setError(failed.length ? failed.join(' / ') : null);
    });
    return () => {
      alive = false;
    };
  }, [list, from, to, key, nonce]);

  // Refresh when the app comes back to the foreground.
  useEffect(() => {
    const v = () => document.visibilityState === 'visible' && reload();
    document.addEventListener('visibilitychange', v);
    return () => document.removeEventListener('visibilitychange', v);
  }, [reload]);

  return { events, error, reload };
}

export const shiftCalsFor = (s: Settings): ShiftCals | null =>
  s.shiftCals && s.shiftCals.main === s.sharedCalId ? s.shiftCals.cals : null;

const DEFAULT_SETTINGS: Settings = { sharedCalId: null, visibleCalIds: null, reminderMin: 60, syncDays: 120 };

export function useSettings() {
  const [s, setS] = useState<Settings>(() => ({ ...DEFAULT_SETTINGS, ...load<Partial<Settings>>('hc.settings', {}) }));
  const update = useCallback((patch: Partial<Settings>) => {
    setS((prev) => {
      const next = { ...prev, ...patch };
      save('hc.settings', next);
      return next;
    });
  }, []);
  return [s, update] as const;
}

// ---------- Google session ----------

export function useGoogle() {
  const [token, setToken] = useState<Token | null>(storedToken);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initGis().then(() => setReady(true), (e: Error) => setError(e.message));
  }, []);

  // Drop the token when it expires so the UI shows "다시 연결".
  useEffect(() => {
    if (!token) return;
    const t = setTimeout(() => setToken(storedToken()), Math.max(0, token.expires_at - Date.now() - 60_000));
    return () => clearTimeout(t);
  }, [token]);

  const everConnected = load('hc.connected', false);

  const signIn = useCallback(() => {
    setError(null);
    requestToken(!load('hc.connected', false)).then(
      (t) => {
        save('hc.connected', true);
        setToken(t);
      },
      (e: Error) => setError(e.message),
    );
  }, []);

  const signOut = useCallback(() => {
    revoke(storedToken());
    save('hc.connected', false);
    setToken(null);
  }, []);

  const expire = useCallback(() => {
    clearToken();
    setToken(null);
  }, []);

  return { token: token?.access_token ?? null, ready, error, everConnected, signIn, signOut, expire };
}

// ---------- calendar data for the visible range ----------

export type CalData = {
  calendars: GCalendar[];
  events: CalEvent[];
  overrides: Overrides;
  monthMemos: CalEvent[];
};

const EMPTY: CalData = { calendars: [], events: [], overrides: {}, monthMemos: [] };

export function useCalendarData(
  token: string | null,
  settings: Settings,
  updateSettings: (p: Partial<Settings>) => void,
  from: DateStr,
  to: DateStr,
  onAuthError: () => void,
) {
  const cacheKey = `hc.cache.${from}.${to}`;
  const [data, setData] = useState<CalData>(() => load(cacheKey, EMPTY));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const reqId = useRef(0);

  // Show cached data for the new range immediately.
  useEffect(() => {
    setData(load(cacheKey, { ...EMPTY, calendars: load<GCalendar[]>('hc.calendars', []) }));
  }, [cacheKey]);

  // Join link: #join=<calendarId> from the invite link.
  useEffect(() => {
    if (!token) return;
    const m = location.hash.match(/^#join=(.+)$/);
    if (!m) return;
    const id = decodeURIComponent(m[1]);
    subscribeCalendar(token, id).then(() => {
      history.replaceState(null, '', location.pathname + location.search);
      updateSettings({ sharedCalId: id });
    }, (e: Error) => setError(e.message));
  }, [token, updateSettings]);

  useEffect(() => {
    if (!token) return;
    const my = ++reqId.current;
    setLoading(true);
    setError(null);
    (async () => {
      const calendars = await listCalendars(token);
      const byId = new Map(calendars.map((c) => [c.id, c]));
      // Shift calendars are drawn as badges — never fetch them as overlay events.
      const shiftIds = new Set(Object.values(shiftCalsFor(settings) ?? {}));
      const visible = new Set(
        (settings.visibleCalIds ?? calendars.filter((c) => c.selected).map((c) => c.id)).filter((id) => byId.has(id) && !shiftIds.has(id)),
      );
      if (settings.sharedCalId && byId.has(settings.sharedCalId)) visible.add(settings.sharedCalId);

      const lists = await Promise.all(
        [...visible].map(async (id) => {
          const c = byId.get(id)!;
          const evs = await listEvents(token, id, from, to);
          return evs.map((e) =>
            normalize(e, { id, name: c.summaryOverride ?? c.summary, color: c.backgroundColor ?? '#4285f4' }),
          );
        }),
      );
      const all = lists.flat();
      const overrides: Overrides = {};
      for (const e of all) if (e.kind === 'override' && e.shift && e.calendarId === settings.sharedCalId) overrides[e.start] = e.shift;
      const next: CalData = {
        calendars,
        overrides,
        monthMemos: all.filter((e) => e.kind === 'monthMemo'),
        // Shifts/overrides are drawn as badges, not as event bars.
        events: all.filter((e) => !e.kind),
      };
      if (my !== reqId.current) return;
      setData(next);
      save(cacheKey, next);
      save('hc.calendars', calendars);
    })()
      .catch((e: Error) => {
        if (my !== reqId.current) return;
        if (e instanceof AuthError) onAuthError();
        setError(e.message);
      })
      .finally(() => my === reqId.current && setLoading(false));
  }, [token, settings.sharedCalId, settings.visibleCalIds, settings.shiftCals, from, to, nonce, cacheKey, onAuthError]);

  return { ...data, loading, error, reload };
}

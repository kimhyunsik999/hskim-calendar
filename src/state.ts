import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthError, listCalendars, listEvents, normalize, subscribeCalendar, type CalEvent, type GCalendar } from './google/api';
import { clearToken, initGis, requestToken, revoke, storedToken, type Token } from './google/gis';
import type { DateStr } from './lib/date';
import type { Overrides } from './lib/shift';

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
};

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
      const visible = new Set(
        (settings.visibleCalIds ?? calendars.filter((c) => c.selected).map((c) => c.id)).filter((id) => byId.has(id)),
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
  }, [token, settings.sharedCalId, settings.visibleCalIds, from, to, nonce, cacheKey, onAuthError]);

  return { ...data, loading, error, reload };
}

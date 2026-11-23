import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { DaySheet } from './components/DaySheet';
import { MemoSheet } from './components/MemoSheet';
import { MonthGrid } from './components/MonthGrid';
import { SettingsSheet, SHARED_CAL_NAME } from './components/SettingsSheet';
import { StatsSheet } from './components/StatsSheet';
import { AuthError, allDay, createCalendar, deleteEvent, insertEvent, type CalEvent } from './google/api';
import { ensureShiftCalendars, saveMonthMemo, setOverride, shareAll, syncShifts, writeExternals } from './google/sync';
import { addDays, monthGrid, parts, shiftMonth, today, WEEKDAYS, ymd, type DateStr } from './lib/date';
import { holidaysOf, type HolidayMap } from './lib/korean';
import { baseShift, DEFAULT_COLORS, SHIFT_OPTIONS, SYNC_VERSION, textOn, type Shift, type ShiftColors } from './lib/shift';
import { notifySpouse, refreshRegistration } from './lib/push';
import type { ExtCal } from './lib/externalIcs';
import { shiftCalsFor, useCalendarData, useExternalEvents, useGoogle, useSettings, useWeather, weatherLocs } from './state';

/** '2026-12-03' → '12/3' */
const md = (d: DateStr) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

type Panel ={ kind: 'day'; date: DateStr } | { kind: 'settings' } | { kind: 'stats' } | { kind: 'memo' } | null;

function useToday() {
  const [t, setT] = useState(today);
  useEffect(() => {
    const tick = () => setT(today());
    const i = setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(i);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  return t;
}

export default function App() {
  const todayStr = useToday();
  const [ym, setYm] = useState(() => {
    const [y, m] = parts(todayStr);
    return { y, m };
  });
  const [panel, setPanel] = useState<Panel>(null);
  const [settings, update] = useSettings();
  const g = useGoogle();
  const days = useMemo(() => monthGrid(ym.y, ym.m), [ym]);
  const from = days[0];
  const to = days[days.length - 1];
  const data = useCalendarData(g.token, settings, update, from, to, g.expire);
  // iCloud calendars: the list stored in the shared Google calendar wins (so the spouse gets it for free);
  // the per-device list is only a fallback / offline cache.
  // Owner or writer of the shared calendar — both spouses can edit the shared settings.
  const canWrite = ['owner', 'writer'].includes(data.calendars.find((c) => c.id === settings.sharedCalId)?.accessRole ?? '');
  const externalsRaw = data.sharedExternals ?? settings.externals ?? [];
  const extKey = JSON.stringify(externalsRaw);
  const externals = useMemo(() => externalsRaw, [extKey]); // stable identity while the content is unchanged
  const ext = useExternalEvents(externals, from, to);
  const wxLocs = weatherLocs(settings);
  const homeWx = useWeather(wxLocs.home);
  const workWx = useWeather(wxLocs.work);
  const events = useMemo(() => [...data.events, ...ext.events], [data.events, ext.events]);
  const loadError = data.error ?? ext.error;

  const [holidays, setHolidays] = useState<HolidayMap>({});
  useEffect(() => {
    let alive = true;
    // Cover the neighbour months shown while swiping, too.
    const years = [...new Set([parts(addDays(from, -42))[0], parts(from)[0], parts(to)[0], parts(addDays(to, 42))[0]])];
    Promise.all(years.map(holidaysOf)).then((maps) => alive && setHolidays(Object.assign({}, ...maps)));
    return () => {
      alive = false;
    };
  }, [from, to]);

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const canEdit = !!(g.token && settings.sharedCalId);

  const run = useCallback(
    async (fn: (token: string) => Promise<unknown>, okMsg?: string): Promise<boolean> => {
      if (!g.token) return false;
      setBusy(true);
      try {
        await fn(g.token);
        if (okMsg) setToast(okMsg);
        data.reload();
        return true;
      } catch (e) {
        if (e instanceof AuthError) g.expire();
        setToast((e as Error).message);
        return false;
      } finally {
        setBusy(false);
        setProgress(null);
      }
    },
    [g, data],
  );

  /** Push "○○님이 …" to the spouse's devices. Best effort — never blocks or errors the edit. */
  const tell = useCallback(
    (what: string) => {
      if (!g.token || !settings.sharedCalId) return;
      notifySpouse(g.token, settings.sharedCalId, `${settings.myName || '배우자'}님이 ${what}`).catch(() => undefined);
    },
    [g.token, settings.sharedCalId, settings.myName],
  );

  // Keep this device's push registration current (endpoint rotation, 180-day KV expiry).
  useEffect(() => {
    if (g.token && settings.sharedCalId && settings.myName) refreshRegistration(g.token, settings.sharedCalId, settings.myName).catch(() => undefined);
  }, [g.token, settings.sharedCalId, settings.myName]);

  // One-time move of this device's iCloud list into the shared calendar (owner only), so the spouse gets it.
  const migratedExt = useRef(false);
  useEffect(() => {
    const local = settings.externals ?? [];
    if (migratedExt.current || !g.token || !settings.sharedCalId || !canWrite || data.sharedExternals !== null || !local.length) return;
    migratedExt.current = true;
    writeExternals(g.token, settings.sharedCalId, local).then(data.reload, () => (migratedExt.current = false));
  }, [g.token, settings.sharedCalId, canWrite, data.sharedExternals, settings.externals, data.reload]);

  /** Add/remove iCloud calendars: shared calendar when we own one, otherwise this device only. */
  const saveExternals = (list: ExtCal[]) => {
    if (g.token && settings.sharedCalId && canWrite) {
      run((t) => writeExternals(t, settings.sharedCalId!, list), '공유 캘린더에 저장했습니다 (배우자 폰에도 적용)').then((ok) => {
        if (!ok) return;
        update({ externals: list });
        tell('iCloud 캘린더 목록을 변경했어요');
      });
    } else update({ externals: list });
  };

  const colors = useMemo<ShiftColors>(() => ({ ...DEFAULT_COLORS, ...settings.colors }), [settings.colors]);

  /** Per-shift calendars for the current main calendar (created / colored on demand). */
  const getShiftCals = useCallback(
    async (t: string, refresh = false) => {
      const cached = shiftCalsFor(settings);
      if (cached && !refresh) return cached;
      const cals = await ensureShiftCalendars(t, settings.sharedCalId!, colors);
      update({ shiftCals: { main: settings.sharedCalId!, cals } });
      return cals;
    },
    [settings, colors, update],
  );

  const syncAll = useCallback(
    (okMsg: string) =>
      run(async (t) => {
        setProgress('근무 캘린더 준비 중…');
        const cals = await getShiftCals(t, true); // also re-applies colors
        await syncShifts(t, settings.sharedCalId!, cals, todayStr, addDays(todayStr, settings.syncDays - 1), settings.reminderMin, (d, n) =>
          setProgress(n ? `동기화 중… ${d}/${n}` : '확인 중…'),
        );
      }, okMsg).then((ok) => ok && update({ syncedVersion: SYNC_VERSION })),
    [run, getShiftCals, settings.sharedCalId, settings.syncDays, settings.reminderMin, todayStr, update],
  );

  // Event format changed since this device last synced → re-sync once automatically.
  const autoSynced = useRef(false);
  useEffect(() => {
    if (!g.token || !settings.sharedCalId || (settings.syncedVersion ?? 1) >= SYNC_VERSION || autoSynced.current) return;
    autoSynced.current = true;
    syncAll('근무 일정을 새 형식으로 업데이트했습니다');
  }, [g.token, settings.sharedCalId, settings.syncedVersion, syncAll]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const go = (delta: number) => setYm((v) => shiftMonth(v.y, v.m, delta));
  const isCurrent = ym.y === parts(todayStr)[0] && ym.m === parts(todayStr)[1];

  // ---- Swipe: the month strip [prev | current | next] follows the finger, then glides to the neighbour. ----
  const mainRef = useRef<HTMLElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; t: number; axis?: 'x' | 'y'; dx: number } | null>(null);
  const animating = useRef(false);
  const lastDragEnd = useRef(0);

  /** Offset the strip by dx px from "showing current month", optionally animated. */
  const setStrip = (dx: number, ms = 0, ease = 'cubic-bezier(.22,.8,.3,1)') => {
    const s = stripRef.current;
    if (!s) return;
    s.style.transition = ms ? `transform ${ms}ms ${ease}` : 'none';
    s.style.transform = `translate3d(calc(-100% / 3 + ${dx}px), 0, 0)`;
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (animating.current) return;
    drag.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: performance.now(), dx: 0 };
    setStrip(0);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.touches[0].clientX - d.x;
    const dy = e.touches[0].clientY - d.y;
    if (!d.axis && Math.hypot(dx, dy) > 8) d.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (d.axis !== 'x') return;
    d.dx = dx;
    setStrip(dx);
  };
  const onTouchEnd = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.axis !== 'x') return;
    lastDragEnd.current = Date.now();
    const w = mainRef.current?.clientWidth ?? window.innerWidth;
    const v = d.dx / Math.max(1, performance.now() - d.t); // px/ms
    const commit = Math.abs(d.dx) > w * 0.22 || (Math.abs(v) > 0.35 && Math.abs(d.dx) > 24);
    if (!commit) return setStrip(0, 220);
    const dir = d.dx < 0 ? 1 : -1;
    animating.current = true;
    setStrip(-dir * w, Math.max(140, Math.min(320, ((w - Math.abs(d.dx)) / Math.max(Math.abs(v), 0.8)) | 0)));
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      // Render the new month synchronously, then re-centre without animation — the neighbour panel
      // already showed that month, so the swap is invisible.
      flushSync(() => go(dir));
      setStrip(0);
      animating.current = false;
    };
    stripRef.current?.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 400); // in case transitionend doesn't fire
  };

  const prevYm = shiftMonth(ym.y, ym.m, -1);
  const nextYm = shiftMonth(ym.y, ym.m, 1);
  const prevDays = useMemo(() => monthGrid(prevYm.y, prevYm.m), [prevYm.y, prevYm.m]);
  const nextDays = useMemo(() => monthGrid(nextYm.y, nextYm.m), [nextYm.y, nextYm.m]);
  const onPick = (date: DateStr) => {
    if (Date.now() - lastDragEnd.current < 350) return; // the tap that ended a swipe
    setPanel({ kind: 'day', date });
  };

  const sharedId = settings.sharedCalId;
  const monthMemo = data.monthMemos.find((e) => e.start === ymd(ym.y, ym.m, 1) && e.calendarId === sharedId);

  const colorVars = Object.fromEntries(
    SHIFT_OPTIONS.flatMap((s) => [
      [`--c-${s}`, colors[s]],
      [`--t-${s}`, textOn(colors[s])],
    ]),
  ) as React.CSSProperties;

  return (
    <div className="app" style={colorVars}>
      <header className="top">
        <button className="icon-btn" onClick={() => setPanel({ kind: 'settings' })} aria-label="설정">
          <svg viewBox="0 0 24 24" width="26" height="26"><path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
        </button>
        <h1 onClick={() => go(0)}>
          {ym.y}.{String(ym.m).padStart(2, '0')}
        </h1>
        {!isCurrent && (
          <button className="today-btn" onClick={() => setYm({ y: parts(todayStr)[0], m: parts(todayStr)[1] })}>
            오늘
          </button>
        )}
        <span className="spacer" />
        {data.loading && <span className="spinner" aria-label="불러오는 중" />}
        <button className="icon-btn" onClick={() => setPanel({ kind: 'memo' })} aria-label="월별 메모">
          <svg viewBox="0 0 24 24" width="24" height="24"><path d="M6 2.8h8l4.2 4.2v14.2H6z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
        </button>
        <button className="icon-btn" onClick={() => setPanel({ kind: 'stats' })} aria-label="통계">
          <svg viewBox="0 0 24 24" width="24" height="24"><rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M8 16v-4M12 16V8M16 16v-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
      </header>

      <div className="weekdays">
        {WEEKDAYS.map((w, i) => (
          <span key={w} className={i === 0 ? 'red' : i === 6 ? 'blue' : ''}>
            {w}
          </span>
        ))}
      </div>

      <main ref={mainRef} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
        <div className="strip" ref={stripRef}>
          {/* Neighbours show shifts/holidays/weather (events load once they become current). */}
          <div className="panel" aria-hidden="true">
            <MonthGrid month={prevYm.m} days={prevDays} todayStr={todayStr} events={[]} overrides={data.overrides} holidays={holidays} forecast={homeWx} onPick={onPick} />
          </div>
          <div className="panel">
            <MonthGrid month={ym.m} days={days} todayStr={todayStr} events={events} overrides={data.overrides} holidays={holidays} forecast={homeWx} onPick={onPick} />
          </div>
          <div className="panel" aria-hidden="true">
            <MonthGrid month={nextYm.m} days={nextDays} todayStr={todayStr} events={[]} overrides={data.overrides} holidays={holidays} forecast={homeWx} onPick={onPick} />
          </div>
        </div>
      </main>

      <button className="month-memo" onClick={() => setPanel({ kind: 'memo' })}>
        {monthMemo?.description?.trim() || <span className="muted">월별 메모</span>}
      </button>

      {progress && <div className="sync-banner">⏳ {progress} · 끝날 때까지 앱을 열어두세요</div>}
      {!progress && !busy && g.token && settings.sharedCalId && (settings.syncedVersion ?? 1) < SYNC_VERSION && (
        <button className="reconnect" onClick={() => syncAll('근무 일정 업데이트 완료')}>
          근무 일정 업데이트가 끝나지 않았습니다 · 이어서 하기
        </button>
      )}
      {!g.token && g.everConnected && (
        <button className="reconnect" onClick={g.signIn} disabled={!g.ready}>
          Google 연결이 만료되었습니다 · 다시 연결
        </button>
      )}
      {(loadError || toast) && <div className="toast">{toast ?? loadError}</div>}

      {panel?.kind === 'day' && (
        <DaySheet
          date={panel.date}
          events={events}
          overrides={data.overrides}
          holidays={holidays}
          sharedCalId={sharedId}
          homeWx={homeWx}
          workWx={workWx}
          places={{ home: wxLocs.home?.name, work: wxLocs.work?.name }}
          canEdit={canEdit}
          busy={busy}
          onClose={() => setPanel(null)}
          onOverride={(date: DateStr, s: Shift | null) =>
            run(async (t) => setOverride(t, sharedId!, await getShiftCals(t), date, s, settings.reminderMin), s ? `${s}(으)로 변경했습니다` : '기본 근무로 되돌렸습니다').then(
              (ok) => ok && tell(`${md(date)} 근무를 ${s ?? `기본(${baseShift(date)})`}(으)로 변경했어요`),
            )
          }
          onAddMemo={(date, title, time) =>
            run((t) =>
              insertEvent(
                t,
                sharedId!,
                time
                  ? {
                      summary: title,
                      start: { dateTime: `${date}T${time}:00+09:00` },
                      end: { dateTime: new Date(Date.parse(`${date}T${time}:00+09:00`) + 3_600_000).toISOString() },
                    }
                  : { summary: title, ...allDay(date) },
              ),
            ).then((ok) => ok && tell(`${md(date)}${time ? ` ${time}` : ''} 일정 추가: ${title}`))
          }
          onDelete={(ev: CalEvent) => {
            if (confirm(`"${ev.title}" 일정을 삭제할까요?`))
              run((t) => deleteEvent(t, ev.calendarId, ev.id)).then((ok) => ok && tell(`${md(ev.start)} 일정 삭제: ${ev.title}`));
          }}
        />
      )}
      {panel?.kind === 'stats' && (
        <StatsSheet y={ym.y} m={ym.m} overrides={data.overrides} holidays={holidays} onClose={() => setPanel(null)} />
      )}
      {panel?.kind === 'memo' && (
        <MemoSheet
          key={ym.y * 100 + ym.m}
          m={ym.m}
          initial={monthMemo?.description ?? ''}
          canEdit={canEdit}
          busy={busy}
          onClose={() => setPanel(null)}
          onSave={(text) =>
            run((t) => saveMonthMemo(t, sharedId!, ymd(ym.y, ym.m, 1), text, monthMemo?.id), '저장했습니다').then((ok) => {
              setPanel(null);
              if (ok) tell(`${ym.m}월 메모를 수정했어요`);
            })
          }
        />
      )}
      {panel?.kind === 'settings' && (
        <SettingsSheet
          settings={settings}
          update={update}
          colors={colors}
          token={g.token}
          externals={externals}
          externalsShared={!!(g.token && settings.sharedCalId)}
          canEditExternals={!(g.token && settings.sharedCalId) || canWrite}
          onExternals={saveExternals}
          calendars={data.calendars}
          connected={!!g.token}
          ready={g.ready}
          everConnected={g.everConnected}
          authError={g.error}
          busy={busy}
          progress={progress}
          onSignIn={g.signIn}
          onSignOut={g.signOut}
          onCreateShared={() =>
            run(async (t) => {
              const c = await createCalendar(t, SHARED_CAL_NAME);
              update({ sharedCalId: c.id });
            }, '공유 캘린더를 만들었습니다')
          }
          onShare={(email) => run(async (t) => shareAll(t, sharedId!, await getShiftCals(t), email), `${email} 에게 공유했습니다`)}
          onSync={() => syncAll('근무 일정 동기화 완료')}
          onClose={() => setPanel(null)}
        />
      )}
    </div>
  );
}

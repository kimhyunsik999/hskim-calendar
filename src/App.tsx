import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DaySheet } from './components/DaySheet';
import { MemoSheet } from './components/MemoSheet';
import { MonthGrid } from './components/MonthGrid';
import { SettingsSheet, SHARED_CAL_NAME } from './components/SettingsSheet';
import { StatsSheet } from './components/StatsSheet';
import { AuthError, allDay, createCalendar, deleteEvent, insertEvent, shareCalendar, type CalEvent } from './google/api';
import { saveMonthMemo, setOverride, syncShifts } from './google/sync';
import { addDays, monthGrid, parts, shiftMonth, today, WEEKDAYS, ymd, type DateStr } from './lib/date';
import { holidaysOf, type HolidayMap } from './lib/korean';
import { SYNC_VERSION, type Shift } from './lib/shift';
import { useCalendarData, useGoogle, useSettings } from './state';

type Panel = { kind: 'day'; date: DateStr } | { kind: 'settings' } | { kind: 'stats' } | { kind: 'memo' } | null;

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

  const [holidays, setHolidays] = useState<HolidayMap>({});
  useEffect(() => {
    let alive = true;
    const years = [...new Set([parts(from)[0], parts(to)[0]])];
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

  const syncAll = useCallback(
    (okMsg: string) =>
      run(
        (t) =>
          syncShifts(t, settings.sharedCalId!, todayStr, addDays(todayStr, settings.syncDays - 1), settings.reminderMin, (d, n) =>
            setProgress(n ? `동기화 중… ${d}/${n}` : '확인 중…'),
          ),
        okMsg,
      ).then((ok) => ok && update({ syncedVersion: SYNC_VERSION })),
    [run, settings.sharedCalId, settings.syncDays, settings.reminderMin, todayStr, update],
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

  // Swipe left/right to change month.
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY });
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touch.current;
    touch.current = null;
    if (!s) return;
    const dx = e.changedTouches[0].clientX - s.x;
    const dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  };

  const sharedId = settings.sharedCalId;
  const monthMemo = data.monthMemos.find((e) => e.start === ymd(ym.y, ym.m, 1) && e.calendarId === sharedId);

  return (
    <div className="app">
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

      <main onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <MonthGrid
          month={ym.m}
          days={days}
          todayStr={todayStr}
          events={data.events}
          overrides={data.overrides}
          holidays={holidays}
          onPick={(date) => setPanel({ kind: 'day', date })}
        />
      </main>

      <button className="month-memo" onClick={() => setPanel({ kind: 'memo' })}>
        {monthMemo?.description?.trim() || <span className="muted">월별 메모</span>}
      </button>

      {!g.token && g.everConnected && (
        <button className="reconnect" onClick={g.signIn} disabled={!g.ready}>
          Google 연결이 만료되었습니다 · 다시 연결
        </button>
      )}
      {(data.error || toast) && <div className="toast">{toast ?? data.error}</div>}

      {panel?.kind === 'day' && (
        <DaySheet
          date={panel.date}
          events={data.events}
          overrides={data.overrides}
          holidays={holidays}
          sharedCalId={sharedId}
          canEdit={canEdit}
          busy={busy}
          onClose={() => setPanel(null)}
          onOverride={(date: DateStr, s: Shift | null) =>
            run((t) => setOverride(t, sharedId!, date, s, settings.reminderMin), s ? `${s}(으)로 변경했습니다` : '기본 근무로 되돌렸습니다')
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
            )
          }
          onDelete={(ev: CalEvent) => {
            if (confirm(`"${ev.title}" 일정을 삭제할까요?`)) run((t) => deleteEvent(t, ev.calendarId, ev.id));
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
          onSave={(text) => run((t) => saveMonthMemo(t, sharedId!, ymd(ym.y, ym.m, 1), text, monthMemo?.id), '저장했습니다').then(() => setPanel(null))}
        />
      )}
      {panel?.kind === 'settings' && (
        <SettingsSheet
          settings={settings}
          update={update}
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
          onShare={(email) => run((t) => shareCalendar(t, sharedId!, email), `${email} 에게 공유했습니다`)}
          onSync={() => syncAll('근무 일정 동기화 완료')}
          onClose={() => setPanel(null)}
        />
      )}
    </div>
  );
}

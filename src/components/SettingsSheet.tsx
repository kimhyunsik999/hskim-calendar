import { useEffect, useState } from 'react';
import type { GCalendar } from '../google/api';
import { CLIENT_ID } from '../google/gis';
import { ICS_PROXY } from '../lib/externalIcs';
import { currentSubscription, disablePush, enablePush, isStandalone, notifySpouse, pushConfigured } from '../lib/push';
import { HOME_PRESETS, WORK_PRESETS, type WeatherLoc } from '../lib/weather';
import { ANCHOR, DEFAULT_COLORS, SHIFT_OPTIONS, SHIFT_TIMES, type Shift, type ShiftColors } from '../lib/shift';
import { shiftCalsFor, weatherLocs, type LocSetting, type Settings } from '../state';
import { Sheet } from './Sheet';
import { ShiftBadge } from './ShiftBadge';

export const SHARED_CAL_NAME = '4조 근무표';

const COLOR_LABEL: Record<Shift, string> = { A: 'A 주간', B: 'B 오후', C: 'C 야간', 휴: '휴무', 연차: '연차' };

type Props = {
  settings: Settings;
  update: (p: Partial<Settings>) => void;
  colors: ShiftColors;
  token: string | null;
  calendars: GCalendar[];
  connected: boolean;
  ready: boolean;
  everConnected: boolean;
  authError: string | null;
  busy: boolean;
  progress: string | null;
  onSignIn: () => void;
  onSignOut: () => void;
  onCreateShared: () => void;
  onShare: (email: string) => void;
  onSync: () => void;
  onClose: () => void;
};

function PushSetting({ settings, update, token }: { settings: Settings; update: (p: Partial<Settings>) => void; token: string | null }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [msg, setMsg] = useState('');
  const [name, setName] = useState(settings.myName ?? '');
  const calId = settings.sharedCalId;
  useEffect(() => {
    currentSubscription().then((s) => setOn(!!s && Notification.permission === 'granted'), () => setOn(false));
  }, []);
  if (!pushConfigured) return null;
  const ready = !!(token && calId);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg('처리 중…');
    try {
      await fn();
      setMsg(ok);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <section>
      <h3>배우자 변경 알림</h3>
      <p className="muted">한 사람이 앱에서 근무 변경·메모를 하면 다른 사람 폰으로 푸시 알림이 갑니다. 두 분 모두 각자 폰에서 켜주세요.</p>
      {!isStandalone() && <p className="warn">아이폰은 Safari 탭이 아니라 "홈 화면에 추가"한 앱에서 켜야 알림이 옵니다.</p>}
      <div className="row">
        <input placeholder="내 이름 (예: 현식)" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => update({ myName: name.trim() })} />
      </div>
      {on ? (
        <div className="row">
          <span>🔔 이 기기 알림 켜짐</span>
          <button className="btn ghost" disabled={!ready} onClick={() => act(() => disablePush(token!, calId!).then(() => setOn(false)), '알림을 껐습니다.')}>
            끄기
          </button>
        </div>
      ) : (
        <button
          className="btn wide"
          disabled={!ready || !name.trim()}
          onClick={() => {
            update({ myName: name.trim() });
            act(() => enablePush(token!, calId!, name.trim()).then(() => setOn(true)), '이 기기에서 알림을 받습니다.');
          }}
        >
          이 기기에서 알림 받기
        </button>
      )}
      {on && (
        <button className="btn ghost wide" disabled={!ready} onClick={() => act(() => notifySpouse(token!, calId!, `${name || '나'}님 테스트 알림입니다 🔔`, true), '테스트 알림을 보냈습니다.')}>
          테스트 알림 보내기 (나에게도)
        </button>
      )}
      {!ready && <p className="muted">Google 연결과 공유 근무 캘린더 지정이 먼저 필요합니다.</p>}
      {msg && <p className="muted">{msg}</p>}
    </section>
  );
}

function WeatherSetting({ settings, update }: { settings: Settings; update: (p: Partial<Settings>) => void }) {
  const locs = weatherLocs(settings);
  const w = settings.weather ?? {};
  const [msg, setMsg] = useState('');
  const set = (which: 'home' | 'work', v: LocSetting) => update({ weather: { home: w.home, work: w.work ?? (w.id ? { id: w.id, lat: w.lat, lon: w.lon } : undefined), [which]: v } });
  const pick = (which: 'home' | 'work', id: string) => {
    if (id === 'gps') return; // already saved
    if (id !== 'gps-new') return set(which, { id });
    if (!navigator.geolocation) return setMsg('이 기기에서 위치를 사용할 수 없습니다.');
    setMsg('위치 확인 중…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // ~1km precision is plenty for a forecast and avoids storing an exact location.
        const r = (n: number) => Math.round(n * 100) / 100;
        set(which, { id: 'gps', lat: r(pos.coords.latitude), lon: r(pos.coords.longitude) });
        setMsg('현재 위치를 저장했습니다. (이후 이 위치로 고정)');
      },
      () => setMsg('위치 권한이 거부되었습니다.'),
      { timeout: 15000 },
    );
  };
  const row = (which: 'home' | 'work', label: string, presets: WeatherLoc[], cur: WeatherLoc | null) => (
    <div className="row">
      <label>{label}</label>
      <select value={cur?.id ?? 'off'} onChange={(e) => pick(which, e.target.value)}>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
        {cur?.id === 'gps' && <option value="gps">저장한 위치</option>}
        <option value="gps-new">{cur?.id === 'gps' ? '현재 위치로 다시 저장' : '현재 위치로 저장'}</option>
        <option value="off">표시 안 함</option>
      </select>
    </div>
  );
  return (
    <section>
      <h3>출퇴근 날씨</h3>
      {row('home', '🏠 집 (출근)', HOME_PRESETS, locs.home)}
      {row('work', '🏭 회사 (퇴근)', WORK_PRESETS, locs.work)}
      <p className="muted">
        출근: 집에서 출발하는 시각(근무 시작 1시간 전 — A 06시 · B 14시 · C 22시) 날씨를 날짜 칸 아이콘으로 표시합니다. 퇴근: 회사의 퇴근 시각 날씨는 날짜를 누르면 보입니다. 비·눈 가능성이 높거나 영하 5도 이하면 빨갛게 강조. (Open-Meteo, 최대 14일)
      </p>
      {msg && <p className="muted">{msg}</p>}
    </section>
  );
}

function ExternalCalendars({ settings, update }: { settings: Settings; update: (p: Partial<Settings>) => void }) {
  const list = settings.externals ?? [];
  const [name, setName] = useState('가족');
  const [url, setUrl] = useState('');
  const [color, setColor] = useState('#e03131');
  const valid = /^(webcal|https):\/\/\S+$/i.test(url.trim());
  return (
    <section>
      <h3>iCloud 캘린더 (공개 링크)</h3>
      <p className="muted">
        아이폰 캘린더 앱 › 캘린더 목록 › 해당 캘린더 ⓘ › <b>공개 캘린더</b> 켜기 › 링크 공유로 복사한 주소를 붙여넣으세요. (공유받은 캘린더는 만든 사람만 공개로 바꿀 수 있습니다)
      </p>
      {!ICS_PROXY && <p className="warn">iCloud 중계 서버가 아직 설정되지 않았습니다.</p>}
      <ul className="cal-list">
        {list.map((c) => (
          <li key={c.id} className="row">
            <label>
              <i className="dot" style={{ background: c.color }} />
              {c.name}
            </label>
            <button className="btn ghost" onClick={() => confirm(`"${c.name}" 캘린더를 앱에서 뺄까요?`) && update({ externals: list.filter((x) => x.id !== c.id) })}>
              삭제
            </button>
          </li>
        ))}
      </ul>
      <form
        className="ext-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          update({ externals: [...list, { id: `ext:${Date.now().toString(36)}`, name: name.trim() || 'iCloud', url: url.trim(), color }] });
          setUrl('');
        }}
      >
        <div className="row">
          <input placeholder="이름 (예: 가족)" value={name} onChange={(e) => setName(e.target.value)} />
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="색" className="color-in" />
        </div>
        <input placeholder="webcal://p…-caldav.icloud.com/published/…" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" autoCapitalize="off" autoCorrect="off" />
        <button className="btn wide" disabled={!valid}>
          iCloud 캘린더 추가
        </button>
      </form>
    </section>
  );
}

export function SettingsSheet(p: Props) {
  const { settings, calendars } = p;
  const [email, setEmail] = useState('');
  const [copied, setCopied] = useState('');
  const shared = calendars.find((c) => c.id === settings.sharedCalId);
  const shiftIds = new Set(Object.values(shiftCalsFor(settings) ?? {}));
  const isShiftCal = (c: GCalendar) => shiftIds.has(c.id) || /^4조 (A 주간|B 오후|C 야간|휴무)$/.test(c.summary);
  const writable = calendars.filter((c) => (c.accessRole === 'owner' || c.accessRole === 'writer') && !isShiftCal(c));
  const visible = new Set(settings.visibleCalIds ?? calendars.filter((c) => c.selected).map((c) => c.id));
  const base = location.origin + import.meta.env.BASE_URL;
  const inviteLink = settings.sharedCalId ? `${base}#join=${encodeURIComponent(settings.sharedCalId)}` : '';
  const icsLink = `${base}shifts.ics`.replace(/^https?:/, 'webcal:');

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      prompt('복사해서 사용하세요', text);
    }
  };

  return (
    <Sheet title="설정" onClose={p.onClose}>
      <section>
        <h3>Google 계정</h3>
        {!CLIENT_ID ? (
          <p className="warn">Google Client ID가 아직 설정되지 않았습니다. (README의 Google 설정 참고)</p>
        ) : p.connected ? (
          <div className="row">
            <span>✅ 연결됨</span>
            <button className="btn ghost" onClick={p.onSignOut}>
              연결 해제
            </button>
          </div>
        ) : (
          <button className="btn wide" disabled={!p.ready} onClick={p.onSignIn}>
            {p.everConnected ? 'Google 다시 연결' : 'Google 캘린더 연결'}
          </button>
        )}
        {p.authError && <p className="warn">{p.authError}</p>}
      </section>

      {p.connected && (
        <>
          <section>
            <h3>공유 근무 캘린더</h3>
            <p className="muted">근무 일정·근무 변경·메모가 저장되는 Google 캘린더입니다. 부부가 같은 캘린더를 지정하면 함께 보고 편집합니다.</p>
            <select value={settings.sharedCalId ?? ''} onChange={(e) => p.update({ sharedCalId: e.target.value || null })}>
              <option value="">선택 안 함</option>
              {writable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.summaryOverride ?? c.summary}
                </option>
              ))}
            </select>
            {!writable.some((c) => (c.summaryOverride ?? c.summary) === SHARED_CAL_NAME) && (
              <button className="btn wide" disabled={p.busy} onClick={p.onCreateShared}>
                "{SHARED_CAL_NAME}" 캘린더 새로 만들기
              </button>
            )}
            {shared && shared.accessRole === 'owner' && (
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (email.trim()) p.onShare(email.trim());
                }}
              >
                <input type="email" placeholder="배우자 Google 이메일" value={email} onChange={(e) => setEmail(e.target.value)} />
                <button className="btn" disabled={p.busy || !email.trim()}>
                  공유
                </button>
              </form>
            )}
            {shared && (
              <button className="btn ghost wide" onClick={() => copy(inviteLink, 'invite')}>
                {copied === 'invite' ? '복사됨 ✓' : '배우자용 앱 링크 복사 (열면 이 캘린더가 자동 지정)'}
              </button>
            )}
          </section>

          <section>
            <h3>알람 · 근무 일정 동기화</h3>
            <p className="muted">근무를 Google 캘린더 4개(4조 A 주간 · B 오후 · C 야간 · 휴무)에 색깔별로 넣고, 근무 시작 전에 알림이 오게 합니다. 아이폰 설정 › 캘린더 › 계정에 Google 계정을 추가하면 아이폰 기본 캘린더와 알림에도 나타납니다.</p>
            <div className="row">
              <label>알림</label>
              <select value={settings.reminderMin} onChange={(e) => p.update({ reminderMin: Number(e.target.value) })}>
                <option value={0}>끄기</option>
                {[30, 60, 90, 120, 180].map((n) => (
                  <option key={n} value={n}>
                    출근 {n >= 60 ? `${n / 60}시간` : `${n}분`} 전
                  </option>
                ))}
              </select>
            </div>
            <div className="row">
              <label>동기화 기간</label>
              <select value={settings.syncDays} onChange={(e) => p.update({ syncDays: Number(e.target.value) })}>
                {[60, 120, 180, 365].map((n) => (
                  <option key={n} value={n}>
                    오늘부터 {n}일
                  </option>
                ))}
              </select>
            </div>
            <button className="btn wide" disabled={!settings.sharedCalId || p.busy} onClick={p.onSync}>
              {p.progress ?? '근무 일정 동기화'}
            </button>
          </section>

          <section>
            <h3>달력에 표시할 캘린더</h3>
            <ul className="cal-list">
              {calendars.filter((c) => !isShiftCal(c)).map((c) => (
                <li key={c.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={visible.has(c.id) || c.id === settings.sharedCalId}
                      disabled={c.id === settings.sharedCalId}
                      onChange={(e) => {
                        const next = new Set(visible);
                        if (e.target.checked) next.add(c.id);
                        else next.delete(c.id);
                        p.update({ visibleCalIds: [...next] });
                      }}
                    />
                    <i className="dot" style={{ background: c.backgroundColor }} />
                    {c.summaryOverride ?? c.summary}
                  </label>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <PushSetting settings={settings} update={p.update} token={p.token} />

      <ExternalCalendars settings={settings} update={p.update} />

      <WeatherSetting settings={settings} update={p.update} />

      <section>
        <h3>근무 색상</h3>
        <div className="color-grid">
          {SHIFT_OPTIONS.map((s) => (
            <label key={s} className="color-item">
              <ShiftBadge shift={s} />
              <span className="name">{COLOR_LABEL[s]}</span>
              <input
                type="color"
                value={p.colors[s]}
                onChange={(e) => p.update({ colors: { ...settings.colors, [s]: e.target.value } })}
                aria-label={`${COLOR_LABEL[s]} 색`}
              />
            </label>
          ))}
        </div>
        <button className="btn ghost wide" onClick={() => p.update({ colors: { ...DEFAULT_COLORS } })}>
          기본 색으로 되돌리기
        </button>
        <p className="muted">
          앱에는 바로 적용됩니다. 아이폰·구글 캘린더 색은 "근무 일정 동기화"를 누르면 바뀝니다. (연차는 휴무 캘린더에 들어가므로 아이폰 캘린더에서는 휴무 색으로 보입니다)
        </p>
      </section>

      <section>
        <h3>아이폰 캘린더 구독 (Google 없이)</h3>
        <p className="muted">기본 4조 근무 패턴만 들어 있는 구독 링크입니다. 근무 변경은 반영되지 않습니다.</p>
        <button className="btn ghost wide" onClick={() => copy(icsLink, 'ics')}>
          {copied === 'ics' ? '복사됨 ✓' : '구독 링크 복사'}
        </button>
        <a className="btn ghost wide" href={icsLink}>
          아이폰 캘린더에 바로 구독
        </a>
      </section>

      <section className="muted small">
        4조 · 24일 주기 (A6 휴2 B6 휴2 C6 휴2), 기준 {ANCHOR} = A 1일차 · A {SHIFT_TIMES.A.start}-{SHIFT_TIMES.A.end} · B {SHIFT_TIMES.B.start}-
        {SHIFT_TIMES.B.end} · C {SHIFT_TIMES.C.start}-{SHIFT_TIMES.C.end}
      </section>
    </Sheet>
  );
}

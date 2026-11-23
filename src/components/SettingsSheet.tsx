import { useState } from 'react';
import type { GCalendar } from '../google/api';
import { CLIENT_ID } from '../google/gis';
import { ANCHOR, SHIFT_TIMES } from '../lib/shift';
import type { Settings } from '../state';
import { Sheet } from './Sheet';

export const SHARED_CAL_NAME = '4조 근무표';

type Props = {
  settings: Settings;
  update: (p: Partial<Settings>) => void;
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

export function SettingsSheet(p: Props) {
  const { settings, calendars } = p;
  const [email, setEmail] = useState('');
  const [copied, setCopied] = useState('');
  const shared = calendars.find((c) => c.id === settings.sharedCalId);
  const writable = calendars.filter((c) => c.accessRole === 'owner' || c.accessRole === 'writer');
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
            <p className="muted">근무를 공유 캘린더에 일정으로 넣고, 근무 시작 전에 알림이 오게 합니다. 아이폰 설정 › 캘린더 › 계정에 Google 계정을 추가하면 아이폰 기본 캘린더와 알림에도 나타납니다.</p>
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
              {calendars.map((c) => (
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

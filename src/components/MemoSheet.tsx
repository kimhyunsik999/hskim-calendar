import { useState } from 'react';
import { Sheet } from './Sheet';

export function MemoSheet({ m, initial, canEdit, busy, onSave, onClose }: { m: number; initial: string; canEdit: boolean; busy: boolean; onSave: (t: string) => void; onClose: () => void }) {
  const [text, setText] = useState(initial);
  return (
    <Sheet title={`${m}월 메모`} onClose={onClose}>
      <textarea className="memo-area" value={text} onChange={(e) => setText(e.target.value)} rows={8} disabled={!canEdit} placeholder="이번 달 메모" />
      <button className="btn wide" disabled={!canEdit || busy} onClick={() => onSave(text)}>
        저장
      </button>
      {!canEdit && <p className="muted">설정에서 Google 연결과 공유 캘린더를 먼저 지정해주세요.</p>}
    </Sheet>
  );
}

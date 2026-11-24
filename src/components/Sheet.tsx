import { useCallback, useEffect, useRef, type ReactNode } from 'react';

const CLOSE_DIST = 110; // px dragged down that closes on release
const CLOSE_SPEED = 0.5; // px/ms flick that closes on release

/**
 * Bottom sheet with iOS-style drag-to-dismiss: pull down on the header — or on the
 * body once it is scrolled to the top — and the sheet follows the finger, then
 * slides away (or springs back). Touches never reach the page underneath.
 */
export function Sheet({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  const backRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  /** Slide the sheet out, then actually close. */
  const dismiss = useCallback(() => {
    const sheet = sheetRef.current;
    const back = backRef.current;
    if (closing.current) return;
    closing.current = true;
    if (!sheet || !back) return closeRef.current();
    sheet.style.transition = 'transform .22s ease-in';
    sheet.style.transform = 'translateY(100%)';
    back.style.transition = 'background-color .22s';
    back.style.backgroundColor = 'rgba(0,0,0,0)';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      closeRef.current();
    };
    sheet.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 300);
  }, []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && dismiss();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [dismiss]);

  useEffect(() => {
    const sheet = sheetRef.current;
    const back = backRef.current;
    const body = bodyRef.current;
    if (!sheet || !back || !body) return;

    let startX = 0;
    let startY = 0;
    let lastY = 0;
    let lastT = 0;
    let speed = 0;
    let mode: 'idle' | 'maybe' | 'drag' | 'scroll' = 'idle';
    let inBody = false;

    const setOffset = (dy: number) => {
      sheet.style.transform = dy ? `translateY(${dy}px)` : '';
      const h = sheet.offsetHeight || 1;
      back.style.backgroundColor = `rgba(0,0,0,${0.35 * Math.max(0, 1 - dy / h)})`;
    };

    const onStart = (e: TouchEvent) => {
      if (closing.current || e.touches.length > 1) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = lastY = t.clientY;
      lastT = e.timeStamp;
      speed = 0;
      inBody = body.contains(e.target as Node);
      mode = 'maybe';
    };

    const onMove = (e: TouchEvent) => {
      if (mode === 'idle' || closing.current) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (mode === 'maybe') {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        const downward = dy > 0 && Math.abs(dy) > Math.abs(dx);
        // In the body, a pull only drags the sheet when the list is already at its top.
        if (downward && (!inBody || body.scrollTop <= 0)) {
          mode = 'drag';
          startY = t.clientY; // start following from here (no jump)
          sheet.style.transition = 'none';
          back.style.transition = 'none';
          (document.activeElement as HTMLElement | null)?.blur?.();
        } else {
          mode = 'scroll';
        }
      }
      if (mode === 'drag') {
        e.preventDefault();
        const off = Math.max(0, t.clientY - startY);
        const dt = e.timeStamp - lastT;
        if (dt > 0) speed = (t.clientY - lastY) / dt;
        lastY = t.clientY;
        lastT = e.timeStamp;
        setOffset(off);
      } else if (!inBody || body.scrollHeight <= body.clientHeight) {
        // Nothing scrollable under the finger: keep the page behind from moving.
        e.preventDefault();
      }
    };

    const onEnd = () => {
      if (mode !== 'drag') {
        mode = 'idle';
        return;
      }
      mode = 'idle';
      const off = lastY - startY;
      if (off > CLOSE_DIST || (speed > CLOSE_SPEED && off > 20)) {
        dismiss();
      } else {
        sheet.style.transition = 'transform .25s cubic-bezier(.2,.9,.3,1.2)';
        back.style.transition = 'background-color .25s';
        setOffset(0);
      }
    };

    // Backdrop drags must never scroll/bounce the page behind it.
    const block = (e: TouchEvent) => {
      if (!sheet.contains(e.target as Node)) e.preventDefault();
    };

    sheet.addEventListener('touchstart', onStart, { passive: true });
    sheet.addEventListener('touchmove', onMove, { passive: false });
    sheet.addEventListener('touchend', onEnd);
    sheet.addEventListener('touchcancel', onEnd);
    back.addEventListener('touchmove', block, { passive: false });
    return () => {
      sheet.removeEventListener('touchstart', onStart);
      sheet.removeEventListener('touchmove', onMove);
      sheet.removeEventListener('touchend', onEnd);
      sheet.removeEventListener('touchcancel', onEnd);
      back.removeEventListener('touchmove', block);
    };
  }, [dismiss]);

  return (
    <div className="sheet-backdrop" ref={backRef} onClick={dismiss}>
      <div className="sheet" ref={sheetRef} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={dismiss} aria-label="닫기">
            ✕
          </button>
        </div>
        <div className="sheet-body" ref={bodyRef}>
          {children}
        </div>
      </div>
    </div>
  );
}

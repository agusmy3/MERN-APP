import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useDismiss from '../hooks/useDismiss';

const POPOVER_WIDTH = 320;

/**
 * Teks satu baris yang dipotong dengan "…" jika melebihi lebar kolom.
 * Hanya jika benar-benar terpotong, teks bisa diklik untuk menampilkan isi lengkapnya.
 */
export default function TruncateText({ text, className = '' }) {
  const textRef = useRef(null);
  const popoverRef = useRef(null);
  const [truncated, setTruncated] = useState(false);
  const [pos, setPos] = useState(null);

  // cek ulang saat teks berubah atau lebar kolom berubah
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const check = () => setTruncated(el.scrollWidth > el.clientWidth);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  const open = pos !== null;
  const close = useCallback(() => setPos(null), []);
  useDismiss(open, [textRef, popoverRef], close);

  const toggle = () => {
    if (!truncated) return;
    if (open) {
      close();
      return;
    }
    const rect = textRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + 4,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8)),
    });
  };

  if (text === null || text === undefined || text === '') {
    return <span className="text-muted">-</span>;
  }

  return (
    <>
      <div
        ref={textRef}
        onClick={toggle}
        onKeyDown={(e) => {
          if (truncated && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            toggle();
          }
        }}
        role={truncated ? 'button' : undefined}
        tabIndex={truncated ? 0 : undefined}
        aria-expanded={truncated ? open : undefined}
        title={truncated ? 'Click to show full text' : undefined}
        className={`truncate ${truncated ? 'cursor-pointer hover:text-primary hover:underline decoration-dotted' : ''} ${className}`}
      >
        {text}
      </div>

      {open && createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: POPOVER_WIDTH }}
          className="z-50 max-h-60 overflow-auto bg-surface text-fg text-sm rounded-md shadow-lg border border-line p-3 whitespace-pre-wrap break-words"
        >
          {text}
        </div>,
        document.body
      )}
    </>
  );
}

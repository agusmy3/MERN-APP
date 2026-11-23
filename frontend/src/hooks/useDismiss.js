import { useEffect, useRef } from 'react';

/**
 * Tutup popup/popover saat: klik di luar `refs`, tekan Esc, window di-resize,
 * atau ada scroll di luar popup (posisi popup fixed, jadi akan tidak sejajar lagi).
 */
export default function useDismiss(open, refs, onClose) {
  // simpan refs terbaru tanpa membuat effect dipasang ulang setiap render
  const refsRef = useRef(refs);
  refsRef.current = refs;

  useEffect(() => {
    if (!open) return;

    const isInside = (target) => refsRef.current.some((r) => r.current?.contains(target));

    const handleMouseDown = (e) => {
      if (!isInside(e.target)) onClose();
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    const handleScroll = (e) => {
      if (!isInside(e.target)) onClose();
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open, onClose]);
}

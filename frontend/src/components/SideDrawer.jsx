import { useEffect } from 'react';
// alias kapital supaya dikenali ESLint no-unused-vars saat dipakai sebagai <Motion.div>
import { motion as Motion, AnimatePresence } from 'framer-motion';

/**
 * Panel baca/tampil dari kanan (bukan form; untuk form pakai FormDrawer). Gaya & animasi sama
 * dengan FormDrawer. Tutup lewat ×, tombol Close, klik backdrop, atau Esc.
 *
 * header = konten tambahan di bawah judul (mis. pemilih/filter), tetap terlihat saat isi di-scroll.
 */
export default function SideDrawer({ open, title, subtitle, onClose, header = null, children, widthClass = 'sm:max-w-2xl' }) {
  useEffect(() => {
    if (!open) return undefined;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <Motion.div
            className="fixed inset-0 bg-black/40 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <Motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === 'string' ? title : undefined}
            className={`fixed top-0 right-0 h-full w-full ${widthClass} bg-surface shadow-xl z-50 flex flex-col`}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.25 }}
          >
            <div className="px-6 py-4 border-b border-line space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-fg truncate">{title}</h2>
                  {subtitle && <p className="text-xs text-muted truncate">{subtitle}</p>}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="w-8 h-8 shrink-0 rounded hover:bg-subtle text-muted cursor-pointer"
                >
                  <i className="fa fa-xmark"></i>
                </button>
              </div>
              {header}
            </div>

            <div className="flex-1 overflow-auto px-6 py-4">{children}</div>

            <div className="px-6 py-4 border-t border-line flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded border border-line hover:bg-subtle cursor-pointer"
              >
                Close
              </button>
            </div>
          </Motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

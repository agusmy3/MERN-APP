import { useEffect } from 'react';
// alias kapital supaya dikenali ESLint no-unused-vars saat dipakai sebagai <Motion.div>
import { motion as Motion, AnimatePresence } from 'framer-motion';

/**
 * Panel form yang muncul dari kanan. Tutup lewat tombol ×, Cancel/Close, klik backdrop, atau Esc.
 * `children` berisi field form; tombol Save memicu `onSubmit`.
 *
 * readOnly = mode Detail: semua field dikunci lewat <fieldset disabled> (tanpa mengubah tiap field),
 * tombol Save diganti Close, dan tombol Edit muncul jika `onEdit` diberikan.
 */
export default function FormDrawer({
  open,
  title,
  onClose,
  onSubmit,
  children,
  submitLabel = 'Save',
  submitting = false,
  readOnly = false,
  onEdit,
  wide = false, // true = drawer lebih lebar (mis. matriks izin di halaman Role)
  aside = null, // konten tambahan di bawah form, DI LUAR fieldset (tetap bisa diklik di mode Detail), mis. History
}) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const handleSubmit = (e) => {
    if (readOnly) {
      e.preventDefault();
      return;
    }
    onSubmit(e);
  };

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
            aria-label={title}
            className={`fixed top-0 right-0 h-full w-full ${wide ? "sm:max-w-2xl" : "sm:max-w-md"} bg-surface shadow-xl z-50`}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.25 }}
          >
            <form onSubmit={handleSubmit} className="flex flex-col h-full">
              <div className="flex items-center justify-between gap-2 px-6 py-4 border-b border-line">
                <div className="min-w-0 flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-fg truncate" title={title}>{title}</h2>
                  {readOnly && (
                    <span className="shrink-0 text-[11px] px-2 py-0.5 rounded-full bg-subtle text-muted border border-line">
                      <i className="fa fa-eye mr-1"></i>Read only
                    </span>
                  )}
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

              <div className="flex-1 overflow-auto px-6 py-4">
                <fieldset disabled={readOnly} className="min-w-0 space-y-4">
                  {children}
                </fieldset>
                {aside && <div className="mt-4">{aside}</div>}
              </div>

              <div className="px-6 py-4 border-t border-line flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded border border-line hover:bg-subtle cursor-pointer"
                >
                  {readOnly ? 'Close' : 'Cancel'}
                </button>
                {readOnly ? (
                  onEdit && (
                    <button
                      type="button"
                      onClick={onEdit}
                      className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded cursor-pointer"
                    >
                      <i className="fa fa-pen"></i> Edit
                    </button>
                  )
                ) : (
                  <button
                    type="submit"
                    disabled={submitting}
                    className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded cursor-pointer disabled:opacity-50"
                  >
                    <i className="fa fa-save"></i> {submitting ? 'Saving...' : submitLabel}
                  </button>
                )}
              </div>
            </form>
          </Motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

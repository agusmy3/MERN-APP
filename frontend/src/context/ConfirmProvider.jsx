import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion as Motion, AnimatePresence } from 'framer-motion';
import { ConfirmContext } from './FeedbackContext';

/**
 * Dialog konfirmasi pengganti confirm() bawaan browser.
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: 'Delete product?', message: '...', confirmLabel: 'Delete', tone: 'danger' }))) return;
 */
export default function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const resolver = useRef(null);
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);

  const confirm = useCallback((options) => new Promise((resolve) => {
    resolver.current?.(false); // tutup dialog sebelumnya jika masih terbuka
    resolver.current = resolve;
    setDialog({
      title: 'Are you sure?',
      message: '',
      confirmLabel: 'Confirm',
      cancelLabel: 'Cancel',
      tone: 'primary',
      ...options,
    });
  }), []);

  const close = useCallback((result) => {
    resolver.current?.(result);
    resolver.current = null;
    setDialog(null);
  }, []);

  // fokus awal: tombol Cancel untuk aksi berbahaya (lebih aman jika Enter tertekan), selain itu tombol Confirm
  useEffect(() => {
    if (!dialog) return;
    (dialog.tone === 'danger' ? cancelRef : confirmRef).current?.focus();
    const handleKey = (e) => {
      if (e.key === 'Escape') close(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [dialog, close]);

  const value = useMemo(() => confirm, [confirm]);
  const isDanger = dialog?.tone === 'danger';

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <AnimatePresence>
        {dialog && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <Motion.div
              className="absolute inset-0 bg-black/40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => close(false)}
            />
            <Motion.div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="confirm-title"
              aria-describedby="confirm-message"
              className="relative w-full max-w-sm rounded-lg border border-line bg-surface text-fg shadow-xl p-5"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'tween', duration: 0.15 }}
            >
              <div className="flex gap-3">
                <span
                  aria-hidden="true"
                  className={`w-10 h-10 shrink-0 rounded-full grid place-items-center ${
                    isDanger ? 'bg-danger-soft text-danger' : 'bg-primary-soft text-primary-soft-fg'
                  }`}
                >
                  <i className={`fa ${isDanger ? 'fa-trash' : 'fa-circle-question'}`}></i>
                </span>
                <div className="min-w-0">
                  <h2 id="confirm-title" className="font-semibold">{dialog.title}</h2>
                  {dialog.message && (
                    <p id="confirm-message" className="mt-1 text-sm text-muted break-words">{dialog.message}</p>
                  )}
                </div>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  ref={cancelRef}
                  type="button"
                  onClick={() => close(false)}
                  className="px-4 py-2 rounded-md border border-line hover:bg-subtle text-sm cursor-pointer"
                >
                  {dialog.cancelLabel}
                </button>
                <button
                  ref={confirmRef}
                  type="button"
                  onClick={() => close(true)}
                  className={`px-4 py-2 rounded-md text-sm font-semibold cursor-pointer ${
                    isDanger
                      ? 'bg-danger text-danger-fg hover:opacity-90'
                      : 'bg-primary text-primary-fg hover:bg-primary-hover'
                  }`}
                >
                  {dialog.confirmLabel}
                </button>
              </div>
            </Motion.div>
          </div>
        )}
      </AnimatePresence>
    </ConfirmContext.Provider>
  );
}
